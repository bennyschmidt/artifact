/**
 * Artifact - Modern version control.
 * @author Benny Schmidt (https://github.com/bennyschmidt)
 * @project https://github.com/bennyschmidt/artifact
 * Module: Caches (v0.3.5)
 */

const fs = require('fs');
const path = require('path');

const { checkout } = require('../branching/index.js');
const getStateByHash = require('../utils/getStateByHash');
const { MAX_PART_SIZE } = require('../utils/constants');

/**
 * Helper to load all changes from a paginated directory (Stage or Stash).
 */

function getPaginatedChanges (directoryPath) {
  /**
   * Locate the manifest file to determine how many parts exist in the cache.
   */

  const manifestPath = path.join(directoryPath, 'manifest.json');

  if (!fs.existsSync(directoryPath) || !fs.existsSync(manifestPath)) {
    return {};
  }

  const manifest = JSON.parse(
    fs.readFileSync(manifestPath, 'utf8')
  );

  let allChanges = {};

  /**
   * Iterate through the parts defined in the manifest and merge them into a single object.
   */

  for (const partName of manifest.parts) {
    const partPath = path.join(directoryPath, partName);

    if (fs.existsSync(partPath)) {
      const partData = JSON.parse(
        fs.readFileSync(partPath, 'utf8')
      );

      Object.assign(allChanges, partData.changes);
    }
  }

  return allChanges;
}

/**
 * Helper to write changes to a paginated directory.
 */

function savePaginatedChanges (directoryPath, changes) {
  /**
   * Clear any existing cache data at the target path before writing new parts.
   */

  if (fs.existsSync(directoryPath)) {
    fs.rmSync(directoryPath, { recursive: true, force: true });
  }

  fs.mkdirSync(directoryPath, { recursive: true });

  const parts = [];

  let currentPartChanges = {};
  let currentSize = 0;

  /**
   * Internal helper to serialize the current change set to a JSON file.
   */

  const savePart = () => {
    if (Object.keys(currentPartChanges).length === 0) {
      return;
    }

    const partName = `part.${parts.length}.json`;

    fs.writeFileSync(
      path.join(directoryPath, partName),
      JSON.stringify({ changes: currentPartChanges }, null, 2)
    );

    parts.push(partName);
    currentPartChanges = {};
    currentSize = 0;
  };

  /**
   * Distribute changes across multiple files if they exceed the MAX_PART_SIZE.
   */

  for (const [file, changeSet] of Object.entries(changes)) {
    const size = JSON.stringify(changeSet).length;

    if (currentSize + size > MAX_PART_SIZE && Object.keys(currentPartChanges).length > 0) {
      savePart();
    }

    currentPartChanges[file] = changeSet;
    currentSize += size;
  }

  savePart();

  /**
   * Write the final manifest so the reader knows which parts to load.
   */

  fs.writeFileSync(
    path.join(directoryPath, 'manifest.json'),
    JSON.stringify({ parts }, null, 2)
  );
}

/**
 * Saves current local changes to a temporary storage or restores the latest stash.
 * @param {Object} options - Stash options.
 * @param {boolean} options.pop - Whether to restore and remove the latest stash.
 * @param {boolean} options.list - Whether to list all existing stashes.
 * @returns {string|Object[]} - Status message or list of stash objects.
 */

function stash ({ pop = false, list = false } = {}) {
  /**
   * Define root and artifact paths required for stash operations.
   */

  const root = process.cwd();
  const artifactPath = path.join(root, '.art');
  const stageDirectory = path.join(artifactPath, 'stage');
  const cachePath = path.join(artifactPath, 'cache');
  const artifactJsonPath = path.join(artifactPath, 'art.json');

  /**
   * Retrieve and format a list of all saved stashes if the list flag is active.
   */

  if (list) {
    if (!fs.existsSync(cachePath)) {
      return [];
    }

    const stashDirectories = [];
    const entries = fs.readdirSync(cachePath);

    for (const entry of entries) {
      const entryPath = path.join(cachePath, entry);
      if (entry.startsWith('stash_') && fs.statSync(entryPath).isDirectory()) {
        stashDirectories.push(entry);
      }
    }

    stashDirectories.sort();

    const formattedStashes = [];

    for (const [index, directoryName] of stashDirectories.entries()) {
      formattedStashes.push({
        id: `stash@{${stashDirectories.length - 1 - index}}`,
        date: new Date(
          parseInt(directoryName.replace('stash_', ''))
        ).toLocaleString(),
        directoryName
      });
    }

    return formattedStashes;
  }

  /**
   * If `pop: true`, restore the most recent stash and delete its cache.
   */

  if (pop) {
    if (!fs.existsSync(cachePath)) {
      throw new Error('No stashes found.');
    }

    const stashes = [];
    const entries = fs.readdirSync(cachePath);

    for (const entry of entries) {
      const entryPath = path.join(cachePath, entry);
      if (entry.startsWith('stash_') && fs.statSync(entryPath).isDirectory()) {
        stashes.push(entry);
      }
    }

    stashes.sort();

    if (stashes.length === 0) {
      throw new Error('No stashes found.');
    }

    const latestStashDirectoryName = stashes[stashes.length - 1];
    const latestStashPath = path.join(cachePath, latestStashDirectoryName);
    const stashChanges = getPaginatedChanges(latestStashPath);

    /**
     * Apply the cached changes back to the working directory.
     */

    for (const [filePath, changeSet] of Object.entries(stashChanges)) {
      const fullPath = path.join(root, filePath);

      if (Array.isArray(changeSet)) {
        let content = fs.existsSync(fullPath)
          ? fs.readFileSync(fullPath, 'utf8')
          : '';

        for (const operation of changeSet) {
          if (operation.type === 'insert') {
            content = `${content.slice(0, operation.position)}${operation.content}${content.slice(operation.position)}`;
          } else if (operation.type === 'delete') {
            content = `${content.slice(0, operation.position)}${content.slice(operation.position + operation.length)}`;
          }
        }

        fs.writeFileSync(fullPath, content);
      } else if (changeSet.type === 'createFile') {
        fs.mkdirSync(path.dirname(fullPath), { recursive: true });
        fs.writeFileSync(fullPath, changeSet.content);
      } else if (changeSet.type === 'deleteFile') {
        if (fs.existsSync(fullPath)) {
          fs.unlinkSync(fullPath);
        }
      }
    }

    fs.rmSync(latestStashPath, { recursive: true, force: true });

    return `Restored changes from ${latestStashDirectoryName}.`;
  }

  /**
   * Create a new stash by comparing the workdir to the last commit.
   */

  const artifactJson = JSON.parse(
    fs.readFileSync(artifactJsonPath, 'utf8')
  );
  const activeState = getStateByHash(artifactJson.active.branch, artifactJson.active.parent) || {};

  const allWorkingDirectoryFiles = fs.readdirSync(root, { recursive: true })
    .filter(file => {
      return !file.startsWith('.art') && !fs.statSync(path.join(root, file)).isDirectory();
    });

  const stashChanges = {};

  /**
   * Diff existing files, handling both text and binary content.
   */

  for (const file of allWorkingDirectoryFiles) {
    const fullPath = path.join(root, file);
    const currentBuffer = fs.readFileSync(fullPath);
    const isBinary = currentBuffer.includes(0);

    const currentContent = isBinary ? null : currentBuffer.toString('utf8');
    const previousContent = activeState[file];

    if (previousContent === undefined) {
      stashChanges[file] = {
        type: 'createFile',
        content: isBinary ? currentBuffer.toString('base64') : currentContent
      };
    } else if (currentContent !== previousContent && !isBinary) {
      let start = 0;

      while (start < previousContent.length && start < currentContent.length && previousContent[start] === currentContent[start]) {
        start++;
      }

      let oldEnd = previousContent.length - 1;
      let newEnd = currentContent.length - 1;

      while (oldEnd >= start && newEnd >= start && previousContent[oldEnd] === currentContent[newEnd]) {
        oldEnd--;
        newEnd--;
      }

      const operations = [];
      const deletionLength = oldEnd - start + 1;

      if (deletionLength > 0) {
        operations.push({ type: 'delete', position: start, length: deletionLength });
      }

      const insertionContent = currentContent.slice(start, newEnd + 1);

      if (insertionContent.length > 0) {
        operations.push({ type: 'insert', position: start, content: insertionContent });
      }

      if (operations.length > 0) {
        stashChanges[file] = operations;
      }
    }
  }

  /**
   * Detect files that were deleted from the working directory.
   */

  for (const file in activeState) {
    if (!fs.existsSync(path.join(root, file))) {
      stashChanges[file] = { type: 'deleteFile' };
    }
  }

  if (Object.keys(stashChanges).length === 0) {
    return 'No local changes to stash.';
  }

  /**
   * Save the detected changes to the cache and revert the working directory.
   */

  const timestamp = Date.now();
  const newStashPath = path.join(cachePath, `stash_${timestamp}`);

  savePaginatedChanges(newStashPath, stashChanges);

  if (fs.existsSync(stageDirectory)) {
    fs.rmSync(stageDirectory, { recursive: true, force: true });
  }

  checkout(artifactJson.active.branch, { force: true });

  return `Stashed working directory changes and reverted to a clean state.`;
}

/**
 * Resets the active state to a specific commit.
 * @param {string} hash - The commit hash to reset to.
 * @returns {string} - Status message.
 */

function reset (hash) {
  /**
   * Clear the staging area before performing a reset.
   */

  const artifactPath = path.join(process.cwd(), '.art');
  const stageDirectory = path.join(artifactPath, 'stage');
  const artifactJsonPath = path.join(artifactPath, 'art.json');

  if (fs.existsSync(stageDirectory)) {
    fs.rmSync(stageDirectory, { recursive: true, force: true });
  }

  if (!hash) {
    return 'Staging area cleared.';
  }

  /**
   * Verify the existence of the commit hash within the active branch history.
   */

  const artifactJson = JSON.parse(
    fs.readFileSync(artifactJsonPath, 'utf8')
  );
  const branchName = artifactJson.active.branch;
  const branchPath = path.join(artifactPath, 'history/local', branchName);
  const commitPath = path.join(branchPath, `${hash}.json`);

  if (!fs.existsSync(commitPath)) {
    throw new Error(`Commit ${hash} not found in branch ${branchName}.`);
  }

  /**
   * Update the active parent pointer and truncate the manifest commits.
   */

  artifactJson.active.parent = hash;
  fs.writeFileSync(artifactJsonPath, JSON.stringify(artifactJson, null, 2));

  const manifestPath = path.join(branchPath, 'manifest.json');
  const manifest = JSON.parse(
    fs.readFileSync(manifestPath, 'utf8')
  );
  const hashIndex = manifest.commits.indexOf(hash);

  if (hashIndex !== -1) {
    manifest.commits = manifest.commits.slice(0, hashIndex + 1);
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  }

  /**
   * Reconstruct the working directory to match the reset commit state.
   */

  checkout(branchName);

  return `Branch is now at ${hash.slice(0, 7)}. Working directory updated.`;
}

/**
 * Removes a file from the working tree and stages the deletion.
 * @param {string} filePath - Path to the file to be removed.
 * @returns {string} - Status message.
 */

function rm (filePath) {
  /**
   * Stage the file deletion by updating the paginated stage cache.
   */

  const artifactPath = path.join(process.cwd(), '.art');
  const fullPath = path.join(process.cwd(), filePath);

  const stage = getPaginatedChanges(
    path.join(artifactPath, 'stage')
  );

  stage[filePath] = { type: 'deleteFile' };

  savePaginatedChanges(
    path.join(artifactPath, 'stage'),
    stage
  );

  /**
   * Physically remove the file from the working directory if it exists.
   */

  if (fs.existsSync(fullPath)) {
    fs.unlinkSync(fullPath);
  }

  return `File ${filePath} marked for removal.`;
}

module.exports = {
  __libraryVersion: '0.3.5',
  __libraryAPIName: 'Caches',
  stash,
  reset,
  rm
};
