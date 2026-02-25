/**
 * Artifact - Modern version control.
 * @author Benny Schmidt (https://github.com/bennyschmidt)
 * @project https://github.com/bennyschmidt/artifact
 * Module: Utils / getStateByHash (v0.3.3)
 */

const fs = require('fs');
const path = require('path');

/**
 * Reconstructs the full file state of a branch at a specific point in time by replaying commits.
 * @param {string} branchName - The branch to read history from.
 * @param {string} targetHash - The commit hash representing the desired state.
 * @returns {Object} A map of file paths to their full string content.
 */

function getStateByHash (branchName, targetHash) {
  /**
   * Initialize repository paths and verify the existence of the root manifest.
   */

  const artifactPath = path.join(process.cwd(), '.art');
  const rootPath = path.join(artifactPath, 'root/manifest.json');

  if (!fs.existsSync(rootPath)) {
    return {};
  }

  /**
   * Load the initial "root" state which serves as the base
   * for all subsequent deltas.
   */

  const rootMaster = JSON.parse(
    fs.readFileSync(rootPath, 'utf8')
  );
  const branchPath = path.join(artifactPath, 'history/local', branchName);
  const manifestPath = path.join(branchPath, 'manifest.json');

  if (!fs.existsSync(manifestPath)) {
    return {};
  }

  const manifest = JSON.parse(
    fs.readFileSync(manifestPath, 'utf8')
  );

  let state = {};

  /**
   * Populate the state object with the original snapshots
   * from the assembled root manifest parts.
   */

  for (const partName of rootMaster.parts) {
    const partPath = path.join(artifactPath, 'root', partName);
    const partData = JSON.parse(
      fs.readFileSync(partPath, 'utf8')
    );

    for (const file of partData.files) {
      state[file.path] = file.content;
    }
  }

  if (!targetHash) {
    return state;
  }

  /**
   * Replay the history of the branch chronologically,
   * applying changes until the target hash is reached.
   */

  for (const hash of manifest.commits) {
    const commitPath = path.join(branchPath, `${hash}.json`);

    if (!fs.existsSync(commitPath)) {
      continue;
    }

    const commitMaster = JSON.parse(
      fs.readFileSync(commitPath, 'utf8')
    );

    let fullChanges = {};

    /**
     * Consolidate changes from commit parts or the master commit file.
     */

    if (commitMaster.parts && Array.isArray(commitMaster.parts)) {
      for (const partName of commitMaster.parts) {
        const partPath = path.join(branchPath, partName);

        if (fs.existsSync(partPath)) {
          const partData = JSON.parse(
            fs.readFileSync(partPath, 'utf8')
          );

          Object.assign(fullChanges, partData.changes);
        }
      }
    } else if (commitMaster.changes) {
      fullChanges = commitMaster.changes;
    }

    /**
     * Apply line-based operations (insert/delete)
     * or file-level operations to the current state.
     */

    for (const [filePath, changeSet] of Object.entries(fullChanges)) {
      if (Array.isArray(changeSet)) {
        let currentContent = state[filePath] || '';

        for (const operation of changeSet) {
          if (operation.type === 'insert') {
            currentContent = `${currentContent.slice(0, operation.position)}${operation.content}${currentContent.slice(operation.position)}`;
          } else if (operation.type === 'delete') {
            currentContent = `${currentContent.slice(0, operation.position)}${currentContent.slice(operation.position + operation.length)}`;
          }
        }

        state[filePath] = currentContent;
      } else {
        if (changeSet.type === 'createFile') {
          state[filePath] = changeSet.content;
        } else if (changeSet.type === 'deleteFile') {
          delete state[filePath];
        }
      }
    }

    if (hash === targetHash) {
      break;
    }
  }

  return state;
}

module.exports = getStateByHash;
