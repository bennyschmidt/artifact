/**
 * Artifact - Modern version control.
 * @author Benny Schmidt (https://github.com/bennyschmidt)
 * @project https://github.com/bennyschmidt/artifact
 * Module: Workflow (v0.3.5)
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const getStateByHash = require('../utils/getStateByHash');
const shouldIgnore = require('../utils/shouldIgnore');
const { MAX_PART_SIZE } = require('../utils/constants');

/**
 * Helper to load all changes from a paginated stage directory.
 * @param {string} artifactPath - Path to the .art directory.
 * @returns {Object} All staged changes merged into one object.
 */

function getStagedChanges (artifactPath) {
  /**
   * Resolve the stage directory and locate the manifest for assembly.
   */

  const stageDirectory = path.join(artifactPath, 'stage');
  const manifestPath = path.join(stageDirectory, 'manifest.json');

  if (!fs.existsSync(stageDirectory) || !fs.existsSync(manifestPath)) {
    return {};
  }

  const manifest = JSON.parse(
    fs.readFileSync(manifestPath, 'utf8')
  );

  let allChanges = {};

  /**
   * Aggregate changes from all registered manifest parts.
   */

  for (const partName of manifest.parts) {
    const partPath = path.join(stageDirectory, partName);

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
 * Compares the working directory against the last commit and pending stage.
 * @returns {Object} Status report containing staged, modified, and untracked files.
 */

function status () {
  /**
   * Initialize workspace paths and retrieve active state and staging info.
   */

  const root = process.cwd();
  const artifactPath = path.join(root, '.art');
  const artifactJsonPath = path.join(artifactPath, 'art.json');

  if (!fs.existsSync(artifactJsonPath)) {
    throw new Error('No art repository found.');
  }

  const artifactJson = JSON.parse(
    fs.readFileSync(artifactJsonPath, 'utf8')
  );
  const activeBranch = artifactJson.active.branch;

  const stagedFiles = getStagedChanges(artifactPath);
  const activeState = getStateByHash(activeBranch, artifactJson.active.parent) || {};

  const allFiles = fs.readdirSync(root, { recursive: true })
    .filter(file => {
      return !fs.statSync(path.join(root, file)).isDirectory();
    });

  const untracked = [];
  const modified = [];
  const ignored = [];

  /**
   * Categorize each file by comparing its working directory state
   * to history and staging.
   */

  for (const file of allFiles) {
    const isStaged = !!stagedFiles[file];
    const isActive = !!activeState[file];

    if (file === '.art' || file.startsWith(`.art${path.sep}`)) {
      continue;
    }

    const isIgnored = shouldIgnore(file);

    if (isIgnored && !isActive && !isStaged) {
      ignored.push(file);

      continue;
    }

    if (!isStaged && !isActive) {
      untracked.push(file);
    } else if (!isStaged && isActive) {
      const currentContent = fs.readFileSync(
        path.join(root, file),
        'utf8'
      );

      if (currentContent !== activeState[file]) {
        modified.push(file);
      }
    }
  }

  return {
    activeBranch,
    lastCommit: artifactJson.active.parent,
    staged: Object.keys(stagedFiles),
    modified,
    untracked,
    ignored
  };
}

/**
 * Updates or creates a JSON diff in the stage directory.
 * @param {string} targetPath - Path to the file or directory to stage.
 * @returns {string} Success message.
 */

function add (targetPath) {
  /**
   * Validate target and load current repository configuration.
   */

  const root = process.cwd();
  const artifactPath = path.join(root, '.art');
  const stageDirectory = path.join(artifactPath, 'stage');
  const artifactJsonPath = path.join(artifactPath, 'art.json');
  const fullPath = path.resolve(root, targetPath);

  if (!fs.existsSync(fullPath)) {
    throw new Error(`Path does not exist: ${targetPath}`);
  }

  const artifactJson = JSON.parse(
    fs.readFileSync(artifactJsonPath, 'utf8')
  );
  const activeState = getStateByHash(artifactJson.active.branch, artifactJson.active.parent) || {};
  const currentStaged = getStagedChanges(artifactPath);

  const stats = fs.statSync(fullPath);
  const relativeTarget = path.relative(root, fullPath);

  if (!stats.isDirectory() && shouldIgnore(relativeTarget) && !activeState[relativeTarget]) {
    return `${relativeTarget} is being ignored.`;
  }

  let filesToProcess = [];

  /**
   * Identify all files to be added, respecting ignore rules unless already tracked.
   */

  if (stats.isDirectory()) {
    const rawFiles = fs.readdirSync(fullPath, { recursive: true });

    for (const entry of rawFiles) {
      const absoluteEntry = path.join(fullPath, entry);
      const relativeEntry = path.relative(root, absoluteEntry);

      if (!fs.statSync(absoluteEntry).isDirectory() && !relativeEntry.startsWith('.art')) {
        if (!shouldIgnore(relativeEntry) || !!activeState[relativeEntry]) {
          filesToProcess.push(relativeEntry);
        }
      }
    }
  } else {
    filesToProcess = [relativeTarget];
  }

  if (filesToProcess.length === 0) {
    return 'No changes to add.';
  }

  /**
   * Calculate deltas for each file and update the staging map.
   */

  for (const relativePath of filesToProcess) {
    const currentContent = fs.readFileSync(
      path.join(root, relativePath),
      'utf8'
    );
    const previousContent = activeState[relativePath];

    if (previousContent === undefined) {
      currentStaged[relativePath] = {
        type: 'createFile',
        content: currentContent
      };
    } else if (currentContent !== previousContent) {
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
        operations.push({
          type: 'delete',
          position: start,
          length: deletionLength,
          content: previousContent.slice(start, oldEnd + 1)
        });
      }

      const insertionContent = currentContent.slice(start, newEnd + 1);

      if (insertionContent.length > 0) {
        operations.push({
          type: 'insert',
          position: start,
          content: insertionContent
        });
      }

      if (operations.length > 0) {
        currentStaged[relativePath] = operations;
      }
    }
  }

  /**
   * Serialize the staging map into paginated JSON files for efficient storage.
   */

  if (fs.existsSync(stageDirectory)) {
    fs.rmSync(stageDirectory, { recursive: true, force: true });
  }

  fs.mkdirSync(stageDirectory, { recursive: true });

  const stageParts = [];

  let currentPartChanges = {};
  let currentSize = 0;

  const savePart = () => {
    const partName = `part.${stageParts.length}.json`;

    fs.writeFileSync(
      path.join(stageDirectory, partName),
      JSON.stringify({ changes: currentPartChanges }, null, 2)
    );

    stageParts.push(partName);
    currentPartChanges = {};
    currentSize = 0;
  };

  for (const [file, changes] of Object.entries(currentStaged)) {
    const size = JSON.stringify(changes).length;

    if (currentSize + size > MAX_PART_SIZE && Object.keys(currentPartChanges).length > 0) {
      savePart();
    }

    currentPartChanges[file] = changes;
    currentSize += size;
  }

  savePart();

  fs.writeFileSync(
    path.join(stageDirectory, 'manifest.json'),
    JSON.stringify({ parts: stageParts }, null, 2)
  );

  return `Added ${filesToProcess.length} file(s) to stage.`;
}

/**
 * Finalizes the paginated stage into a paginated commit structure.
 * @param {string} message - The commit message.
 * @returns {string} Success summary.
 */

function commit (message) {
  /**
   * Validate prerequisites for a commit and calculate the unique commit hash.
   */

  if (!message) {
    throw new Error('A commit message is required.');
  }

  const root = process.cwd();
  const artifactPath = path.join(root, '.art');
  const stageDirectory = path.join(artifactPath, 'stage');
  const artifactJsonPath = path.join(artifactPath, 'art.json');

  if (!fs.existsSync(stageDirectory)) {
    throw new Error('Nothing to commit (stage is empty).');
  }

  const stagedChanges = getStagedChanges(artifactPath);
  const artifactJson = JSON.parse(
    fs.readFileSync(artifactJsonPath, 'utf8')
  );
  const branch = artifactJson.active.branch;
  const timestamp = Date.now();

  const commitHash = crypto
    .createHash('sha1')
    .update(JSON.stringify(stagedChanges) + timestamp + message)
    .digest('hex');

  const branchHistoryDirectory = path.join(artifactPath, 'history', 'local', branch);
  const commitParts = [];

  let currentPartChanges = {};
  let currentPartSize = 0;

  /**
   * Break the commit into paginated parts to handle large datasets.
   */

  const saveCommitPart = () => {
    if (Object.keys(currentPartChanges).length === 0) {
      return;
    }

    const partName = `${commitHash}.part.${commitParts.length}.json`;

    fs.writeFileSync(
      path.join(branchHistoryDirectory, partName),
      JSON.stringify({ changes: currentPartChanges }, null, 2)
    );

    commitParts.push(partName);
    currentPartChanges = {};
    currentPartSize = 0;
  };

  for (const [filePath, changeSet] of Object.entries(stagedChanges)) {
    const changeSize = JSON.stringify(changeSet).length;

    if (currentPartSize + changeSize > MAX_PART_SIZE && Object.keys(currentPartChanges).length > 0) {
      saveCommitPart();
    }

    currentPartChanges[filePath] = changeSet;
    currentPartSize += changeSize;
  }

  saveCommitPart();

  /**
   * Finalize the commit master file and update the branch manifest.
   */

  const commitMaster = {
    hash: commitHash,
    message,
    timestamp,
    parent: artifactJson.active.parent,
    parts: commitParts
  };

  fs.writeFileSync(
    path.join(branchHistoryDirectory, `${commitHash}.json`),
    JSON.stringify(commitMaster, null, 2)
  );

  const manifest = JSON.parse(
    fs.readFileSync(path.join(branchHistoryDirectory, 'manifest.json'), 'utf8')
  );

  manifest.commits.push(commitHash);

  fs.writeFileSync(
    path.join(branchHistoryDirectory, 'manifest.json'),
    JSON.stringify(manifest, null, 2)
  );

  /**
   * Update the active parent reference and clear the staging area.
   */

  artifactJson.active.parent = commitHash;

  fs.writeFileSync(
    artifactJsonPath,
    JSON.stringify(artifactJson, null, 2)
  );

  fs.rmSync(stageDirectory, { recursive: true, force: true });

  return `[${branch} ${commitHash.slice(0, 7)}] ${message}`;
}

module.exports = {
  __libraryVersion: '0.3.5',
  __libraryAPIName: 'Workflow',
  status,
  add,
  commit
};
