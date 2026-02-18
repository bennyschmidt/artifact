/**
 * dep - Simple version control
 * Module: Utils (v0.0.1)
 */

const fs = require('fs');
const path = require('path');

/**
 * Helper to reconstruct file states at a specific commit hash.
 */

module.exports = (branchName, targetHash) => {
  const depPath = path.join(process.cwd(), '.dep');
  const dataPath = path.join(depPath, 'data/manifest.json');

  if (!fs.existsSync(dataPath)) return {};

  const dataManifest = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
  const branchPath = path.join(depPath, 'history/local', branchName);
  const manifestPath = path.join(branchPath, 'manifest.json');

  if (!fs.existsSync(manifestPath)) return {};

  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  let state = {};

  for (const file of dataManifest.files) {
   state[file.path] = file.content;
  }

  for (const hash of manifest.commits) {
   const commitPath = path.join(branchPath, `${hash}.json`);
   const commit = JSON.parse(fs.readFileSync(commitPath, 'utf8'));

   for (const [filePath, change] of Object.entries(commit.changes)) {
     if (change.type === 'createFile' || change.type === 'update') {
       state[filePath] = change.content;
     } else if (change.type === 'deleteFile') {
       delete state[filePath];
     }
   }

   if (hash === targetHash) break;
  }

  return state;
};
