/**
 * Artifact - Modern version control.
 * @author Benny Schmidt (https://github.com/bennyschmidt)
 * @project https://github.com/bennyschmidt/artifact
 * Module: Branching (v0.3.3)
 */

const fs = require('fs');
const path = require('path');

const getStateByHash = require('../utils/getStateByHash');
const { MAX_PART_SIZE } = require('../utils/constants');

/**
 * Lists all existing branches, creates a new branch from the current HEAD,
 * or deletes an existing branch from the local and remote history.
 * * @param {Object} options - The branch options.
 * @param {string} options.name - The name of the branch to create or delete.
 * @param {boolean} options.isDelete - Whether the operation is a deletion.
 * @returns {string|string[]} - A message or an array of branch names.
 */

function branch ({ name, isDelete = false } = {}) {
  /**
   * Define core paths for the .art directory and internal history structures.
   */

  const artifactPath = path.join(process.cwd(), '.art');
  const localHistoryPath = path.join(artifactPath, 'history/local');
  const remoteHistoryPath = path.join(artifactPath, 'history/remote');
  const artifactJsonPath = path.join(artifactPath, 'art.json');

  /**
   * If no branch name is provided, return a list of all local branches.
   * Filters out system files like .DS_Store or thumbs.db.
   */

  if (!name) {
    const branchList = [];
    const entries = fs.readdirSync(localHistoryPath);

    for (const entry of entries) {
      if (entry !== '.DS_Store' && entry !== 'desktop.ini' && entry !== 'thumbs.db') {
        branchList.push(entry);
      }
    }

    return branchList;
  }

  /**
   * Validate the branch name against illegal characters and naming patterns.
   */

  const normalizedName = name.toLowerCase();
  const illegalRegularExpression = /[\/\\]/g;
  const controlRegularExpression = /[\x00-\x1f\x80-\x9f]/g;
  const reservedRegularExpression = /^\.+$/;

  if (illegalRegularExpression.test(name) || controlRegularExpression.test(name) || reservedRegularExpression.test(name)) {
    throw new Error(`Invalid branch name: "${name}". Branch names cannot contain slashes or illegal characters.`);
  }

  const branchLocalPath = path.join(localHistoryPath, name);
  const branchRemotePath = path.join(remoteHistoryPath, name);

  /**
   * Pass `isDelete: true` to delete the branch in question.
   * This is automatically set to true with CLI flags: --delete, -d, -D.
   */

  if (isDelete) {
    if (!fs.existsSync(branchLocalPath)) {
      throw new Error(`Local branch "${name}" does not exist.`);
    }

    const artifactJson = JSON.parse(
      fs.readFileSync(artifactJsonPath, 'utf8')
    );

    if (artifactJson.active.branch === name) {
      throw new Error(`Local branch "${name}" is in use and can't be deleted right now.`);
    }

    fs.rmSync(branchLocalPath, { recursive: true, force: true });

    if (fs.existsSync(branchRemotePath)) {
      fs.rmSync(branchRemotePath, { recursive: true, force: true });
    }

    return `Deleted local branch "${name}".`;
  }

  /**
   * Check if the branch already exists before attempting creation.
   */

  if (fs.existsSync(branchLocalPath)) {
    throw new Error(`Local branch "${name}" already exists.`);
  }

  /**
   * Read the active branch manifest to determine the starting commit history.
   */

  const artifactJson = JSON.parse(
    fs.readFileSync(artifactJsonPath, 'utf8')
  );

  const sourceBranchName = artifactJson.active.branch;
  const currentBranchManifest = path.join(localHistoryPath, sourceBranchName, 'manifest.json');

  let initialCommits = [];

  if (fs.existsSync(currentBranchManifest)) {
    initialCommits = JSON.parse(
      fs.readFileSync(currentBranchManifest, 'utf8')
    ).commits;
  }

  /**
   * Create the local branch directory and initialize the manifest file.
   */

  fs.mkdirSync(branchLocalPath, { recursive: true });

  fs.writeFileSync(
    path.join(branchLocalPath, 'manifest.json'),
    JSON.stringify({ commits: initialCommits }, null, 2)
  );

  /**
   * Initialize the remote tracking directory for the new branch
   * (if it doesn't exist).
   */

  if (!fs.existsSync(branchRemotePath)) {
    fs.mkdirSync(branchRemotePath, { recursive: true });

    fs.writeFileSync(
      path.join(branchRemotePath, 'manifest.json'),
      JSON.stringify({ commits: initialCommits }, null, 2)
    );
  }

  /**
   * Copy all commit data and files from the source branch to the new branch.
   */

  if (initialCommits.length > 0) {
    const sourceBranchPath = path.join(localHistoryPath, sourceBranchName);
    const sourceRemotePath = path.join(remoteHistoryPath, sourceBranchName);

    for (const hash of initialCommits) {
      let masterFile = path.join(sourceBranchPath, `${hash}.json`);
      let currentSourceDirectory = sourceBranchPath;

      if (!fs.existsSync(masterFile)) {
        masterFile = path.join(sourceRemotePath, `${hash}.json`);
        currentSourceDirectory = sourceRemotePath;
      }

      if (fs.existsSync(masterFile)) {
        fs.copyFileSync(masterFile, path.join(branchLocalPath, `${hash}.json`));

        const commitMaster = JSON.parse(
          fs.readFileSync(masterFile, 'utf8')
        );

        if (commitMaster.parts && Array.isArray(commitMaster.parts)) {
          for (const partName of commitMaster.parts) {
            const sourcePart = path.join(currentSourceDirectory, partName);
            const destinationPart = path.join(branchLocalPath, partName);

            if (fs.existsSync(sourcePart)) {
              fs.copyFileSync(sourcePart, destinationPart);
            }
          }
        }
      }
    }
  }

  return `Created branch "${name}".`;
}

/**
 * Updates the active branch pointer and reconstructs the working directory
 * based on the state of the target branch's latest commit.
 * * @param {string} branchName - The name of the branch to switch to.
 * @param {Object} options - Checkout options.
 * @param {boolean} options.force - Whether to ignore local changes.
 * @returns {string} - Success message.
 */

function checkout (branchName, { force = false } = {}) {
  /**
   * Setup paths and ensure the target branch exists, creating it if necessary.
   */

  const root = process.cwd();
  const artifactPath = path.join(root, '.art');
  const artifactJsonPath = path.join(artifactPath, 'art.json');
  const branchPath = path.join(artifactPath, 'history/local', branchName);

  if (!fs.existsSync(branchPath)) {
    branch({ name: branchName });
  }

  /**
   * Retrieve current state to check for uncommitted changes.
   */

  const artifactJson = JSON.parse(
    fs.readFileSync(artifactJsonPath, 'utf8')
  );

  const currentState = getStateByHash(artifactJson.active.branch, artifactJson.active.parent) || {};

  /**
   * Verify if the working directory is dirty.
   * Throws an error unless `force: true` is passed.
   */

  if (!force) {
    const allWorkingDirectoryFiles = fs.readdirSync(root, { recursive: true })
      .filter(file => {
        return !file.startsWith('.art') && !fs.statSync(path.join(root, file)).isDirectory();
      });

    let isDirty = false;

    for (const file of allWorkingDirectoryFiles) {
      const currentContent = fs.readFileSync(path.join(root, file), 'utf8');

      if (currentContent !== currentState[file]) {
        isDirty = true;

        break;
      }
    }

    if (!isDirty) {
      for (const file in currentState) {
        if (!fs.existsSync(path.join(root, file))) {
          isDirty = true;

          break;
        }
      }
    }

    if (isDirty) {
      throw new Error('Your local changes would be overwritten by checkout. Please commit or stash them.');
    }
  }

  /**
   * Identify the latest commit hash for the target branch.
   */

  const manifest = JSON.parse(
    fs.readFileSync(path.join(branchPath, 'manifest.json'), 'utf8')
  );

  const targetHash = manifest.commits.length > 0
    ? manifest.commits[manifest.commits.length - 1]
    : null;

  const targetState = getStateByHash(branchName, targetHash);

  /**
   * Clean up files that exist in the current state but not in the target state.
   */

  for (const filePath of Object.keys(currentState)) {
    if (!targetState[filePath]) {
      const fullPath = path.join(root, filePath);

      if (fs.existsSync(fullPath)) {
        fs.rmSync(fullPath, { recursive: true, force: true });
      }
    }
  }

  /**
   * Write target state files to the working directory.
   */

  for (const [filePath, content] of Object.entries(targetState)) {
    const fullPath = path.join(root, filePath);

    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, content);
  }

  /**
   * Update the active branch and parent pointers in art.json.
   */

  artifactJson.active.branch = branchName;
  artifactJson.active.parent = targetHash;
  fs.writeFileSync(artifactJsonPath, JSON.stringify(artifactJson, null, 2));

  return `Switched to branch "${branchName}".`;
}

/**
 * Performs a three-way merge between the active branch and the target branch.
 * If conflicts are detected, the working directory is updated with markers.
 * * @param {string} targetBranch - The branch to merge into the active branch.
 * @returns {string} - Success message.
 */

function merge (targetBranch) {
  /**
   * Initialize staging environment and load manifests for the merge operation.
   */

  const root = process.cwd();
  const artifactPath = path.join(root, '.art');
  const stageDirectory = path.join(artifactPath, 'stage');
  const artifactJson = JSON.parse(
    fs.readFileSync(path.join(artifactPath, 'art.json'), 'utf8')
  );
  const activeBranch = artifactJson.active.branch;

  if (fs.existsSync(stageDirectory)) {
    fs.rmSync(stageDirectory, { recursive: true, force: true });
  }

  fs.mkdirSync(stageDirectory, { recursive: true });

  const activeManifest = JSON.parse(
    fs.readFileSync(path.join(artifactPath, `history/local/${activeBranch}/manifest.json`), 'utf8')
  );
  const targetManifest = JSON.parse(
    fs.readFileSync(path.join(artifactPath, `history/local/${targetBranch}/manifest.json`), 'utf8')
  );

  /**
   * Locate the most recent common ancestor hash between both branches.
   */

  const commonAncestorHash = [...activeManifest.commits].reverse().find(hash => {
    return targetManifest.commits.includes(hash);
  }) || null;

  /**
   * Capture the file states for the base (ancestor), active, and target branches.
   */

  const baseState = commonAncestorHash ? getStateByHash(activeBranch, commonAncestorHash) : {};
  const activeState = getStateByHash(activeBranch, artifactJson.active.parent);
  const lastTargetHash = targetManifest.commits[targetManifest.commits.length - 1];
  const targetState = getStateByHash(targetBranch, lastTargetHash);
  const allFiles = new Set([...Object.keys(activeState), ...Object.keys(targetState)]);

  /**
   * Prepare the staging mechanism for multi-part change tracking.
   */

  let currentPartChanges = {};
  let currentPartSize = 0;
  let partCount = 0;

  const saveStagePart = () => {
    if (Object.keys(currentPartChanges).length === 0) {
      return;
    }

    const partPath = path.join(stageDirectory, `part.${partCount}.json`);

    fs.writeFileSync(partPath, JSON.stringify({ changes: currentPartChanges }, null, 2));
    currentPartChanges = {};
    currentPartSize = 0;
    partCount++;
  };

  /**
   * Iterate through all unique files to determine merge actions.
   */

  for (const filePath of allFiles) {
    const base = baseState[filePath];
    const active = activeState[filePath];
    const target = targetState[filePath];
    const fullPath = path.join(root, filePath);

    if (active === target) {
      continue;
    }

    let change = null;

    /**
     * Logic for applying target changes if they don't conflict with active
     * local modifications.
     */

    if (base === active && base !== target) {
      if (target === undefined) {
        if (fs.existsSync(fullPath)) {
          fs.unlinkSync(fullPath);
        }

        change = { type: 'deleteFile' };
      } else {
        fs.mkdirSync(path.dirname(fullPath), { recursive: true });
        fs.writeFileSync(fullPath, target);
        change = { type: 'createFile', content: target };
      }
    } else if (base !== active && base !== target && active !== target) {
      /**
       * Handle three-way merge conflicts by injecting markers into the target file.
       */

      const conflictContent = `<<<<<<< active\n${active || ''}\n=======\n${target || ''}\n>>>>>>> ${targetBranch}`;

      fs.mkdirSync(path.dirname(fullPath), { recursive: true });
      fs.writeFileSync(fullPath, conflictContent);
      change = { type: 'createFile', content: conflictContent };
    }

    /**
     * Calculate change size and partition the stage.
     */

    if (change) {
      const changeSize = JSON.stringify(change).length;

      if (currentPartSize + changeSize > MAX_PART_SIZE) {
        saveStagePart();
      }

      currentPartChanges[filePath] = change;
      currentPartSize += changeSize;
    }
  }

  /**
   * Finalize the merge by saving the last stage part and the manifest summary.
   */

  saveStagePart();

  fs.writeFileSync(
    path.join(stageDirectory, 'manifest.json'),
    JSON.stringify({ parts: Array.from({ length: partCount }, (_, index) => `part.${index}.json`) }, null, 2)
  );

  return `Merged ${targetBranch}.`;
}

module.exports = {
  __libraryVersion: '0.3.3',
  __libraryAPIName: 'Branching',
  branch,
  checkout,
  merge
};
