/**
 * art - Modern version control.
 * Module: Changes (v0.3.2)
 */

const fs = require('fs');
const path = require('path');

const getStateByHash = require('../utils/getStateByHash');

/**
 * Iterates through the JSON commit files in the active branch folder.
 * @returns {string} A formatted string of commit history.
 */

function log () {
  const artPath = path.join(process.cwd(), '.art');
  const artJsonPath = path.join(artPath, 'art.json');

  if (!fs.existsSync(artJsonPath)) {
    throw new Error('No art repository found.');
  }

  const artJson = JSON.parse(fs.readFileSync(artJsonPath, 'utf8'));
  const branch = artJson.active.branch;
  const branchPath = path.join(artPath, 'history/local', branch);
  const manifestPath = path.join(branchPath, 'manifest.json');

  if (!fs.existsSync(manifestPath)) {
    return 'No commits found.';
  }

  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

  let output = `Branch: ${branch}\n\n`;

  for (let i = manifest.commits.length - 1; i >= 0; i--) {
    const hash = manifest.commits[i];
    const commitMasterPath = path.join(branchPath, `${hash}.json`);

    if (fs.existsSync(commitMasterPath)) {
      const commitData = JSON.parse(fs.readFileSync(commitMasterPath, 'utf8'));

      output += `commit ${commitData.hash}\n`;
      output += `Date: ${new Date(commitData.timestamp).toLocaleString()}\n`;
      output += `\n    ${commitData.message}\n\n`;
    }
  }

  return output;
}

/**
 * Displays line-by-line differences between working directory and the last commit/stage.
 * @returns {object} Formatted diff output and staged file list.
 */

function diff () {
  const root = process.cwd();
  const artPath = path.join(root, '.art');
  const artJsonPath = path.join(artPath, 'art.json');

  if (!fs.existsSync(artJsonPath)) {
    throw new Error('No art repository found.');
  }

  const artJson = JSON.parse(fs.readFileSync(artJsonPath, 'utf8'));
  const activeBranch = artJson.active.branch;
  const lastCommitHash = artJson.active.parent;
  const lastCommitState = lastCommitHash ? getStateByHash(activeBranch, lastCommitHash) : {};

  const currentFiles = fs.readdirSync(root, { recursive: true })
    .filter(f => !f.startsWith('.art') && !fs.statSync(path.join(root, f)).isDirectory());

  const fileDiffs = [];

  for (const filePath of currentFiles) {
    const fullPath = path.join(root, filePath);
    const currentBuffer = fs.readFileSync(fullPath);
    const isBinary = currentBuffer.includes(0);

    const currentContent = isBinary ? null : currentBuffer.toString('utf8');
    const previousContent = lastCommitState[filePath] || '';

    if (!isBinary && currentContent !== previousContent) {
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

      fileDiffs.push({
        file: filePath,
        deleted: previousContent.slice(start, oldEnd + 1),
        added: currentContent.slice(start, newEnd + 1)
      });
    } else if (isBinary) {
      const prevHash = lastCommitState[filePath] ? 'exists' : 'null';

      if (prevHash === 'null') {
        fileDiffs.push({ file: filePath, added: '<Binary Data>', deleted: '' });
      }
    }
  }

  const stageDir = path.join(artPath, 'stage');
  const stageManifestPath = path.join(stageDir, 'manifest.json');

  let staged = [];

  if (fs.existsSync(stageManifestPath)) {
    const manifest = JSON.parse(fs.readFileSync(stageManifestPath, 'utf8'));
    const stagedFilesSet = new Set();

    for (const partName of manifest.parts) {
      const partPath = path.join(stageDir, partName);

      if (fs.existsSync(partPath)) {
        const partData = JSON.parse(fs.readFileSync(partPath, 'utf8'));

        Object.keys(partData.changes).forEach(file => stagedFilesSet.add(file));
      }
    }
    staged = Array.from(stagedFilesSet);
  }

  return { fileDiffs, staged };
}

module.exports = {
  __libraryVersion: '0.3.2',
  __libraryAPIName: 'Changes',
  log,
  diff
};
