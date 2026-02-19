/**
 * dep - Modern version control.
 * Module: Changes (v0.2.1)
 */

const fs = require('fs');
const path = require('path');

const getStateByHash = require('../utils/getStateByHash');

/**
 * Iterates through the JSON commit files in the active branch folder.
 * @returns {string} A formatted string of commit history.
 */

function log () {
  const depPath = path.join(process.cwd(), '.dep');
  const depJsonPath = path.join(depPath, 'dep.json');

  if (!fs.existsSync(depJsonPath)) {
    throw new Error('No dep repository found.');
  }

  const depJson = JSON.parse(fs.readFileSync(depJsonPath, 'utf8'));
  const branch = depJson.active.branch;
  const branchPath = path.join(depPath, 'history/local', branch);
  const manifestPath = path.join(branchPath, 'manifest.json');

  if (!fs.existsSync(manifestPath)) {
    return 'No commits found.';
  }

  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

  let output = `Branch: ${branch}\n\n`;

  // Display commits in reverse chronological order

  for (let i = manifest.commits.length - 1; i >= 0; i--) {
    const hash = manifest.commits[i];
    const commitData = JSON.parse(fs.readFileSync(path.join(branchPath, `${hash}.json`), 'utf8'));

    output += `commit ${commitData.hash}\n`;
    output += `Date: ${new Date(commitData.timestamp).toLocaleString()}\n`;
    output += `\n    ${commitData.message}\n\n`;
  }

  return output;
}

/**
 * Displays line-by-line differences between working directory and the last commit/stage.
 * @returns {string} Formatted diff output.
 */

 function diff () {
  const root = process.cwd();
  const depPath = path.join(root, '.dep');
  const depJson = JSON.parse(fs.readFileSync(path.join(depPath, 'dep.json'), 'utf8'));

  const activeBranch = depJson.active.branch;
  const lastCommitHash = depJson.active.parent;
  const lastCommitState = lastCommitHash ? getStateByHash(activeBranch, lastCommitHash) : {};

  const currentFiles = fs.readdirSync(root, { recursive: true })
    .filter(f => !f.startsWith('.dep') && !fs.statSync(path.join(root, f)).isDirectory());

  const fileDiffs = [];

  for (const filePath of currentFiles) {
    const fullPath = path.join(root, filePath);
    const currentContent = fs.readFileSync(fullPath, 'utf8');
    const previousContent = lastCommitState[filePath] || '';

    if (currentContent !== previousContent) {
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
    }
  }

  const stagePath = path.join(depPath, 'stage.json');
  const staged = fs.existsSync(stagePath) ? Object.keys(JSON.parse(fs.readFileSync(stagePath, 'utf8')).changes) : [];

  return { fileDiffs, staged };
}

module.exports = {
  __libraryVersion: '0.2.1',
  __libraryAPIName: 'Changes',
  log,
  diff
};
