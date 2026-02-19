/**
 * dep - Modern version control.
 * Module: Utils (v0.2.3)
 */

const fs = require('fs');
const path = require('path');

/**
 * Helper to reconstruct file states at a specific commit hash.
 */

module.exports = (branchName, targetHash) => {
  const depPath = path.join(process.cwd(), '.dep');
  const rootPath = path.join(depPath, 'root/manifest.json');

  if (!fs.existsSync(rootPath)) return {};

  const rootManifest = JSON.parse(fs.readFileSync(rootPath, 'utf8'));
  const branchPath = path.join(depPath, 'history/local', branchName);
  const manifestPath = path.join(branchPath, 'manifest.json');

  if (!fs.existsSync(manifestPath)) return {};

  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

  let state = {};

  for (const file of rootManifest.files) {
    state[file.path] = file.content;
  }

  for (const hash of manifest.commits) {
    const commitPath = path.join(branchPath, `${hash}.json`);

    if (!fs.existsSync(commitPath)) continue;

    const commit = JSON.parse(fs.readFileSync(commitPath, 'utf8'));

    for (const [filePath, changeSet] of Object.entries(commit.changes)) {
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

    if (hash === targetHash) break;
  }

  return state;
};
