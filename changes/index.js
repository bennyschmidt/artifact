/**
 * dep - Simple version control
 * Module: Changes (v0.0.1)
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

  // Get the state as of the last commit

  const lastCommitState = lastCommitHash ? getStateByHash(activeBranch, lastCommitHash) : {};

  // Get current working directory files (excluding .dep)

  const currentFiles = fs.readdirSync(root).filter(f => f !== '.dep' && fs.lstatSync(path.join(root, f)).isFile());

  let output = '';

  for (const filePath of currentFiles) {
    const fullPath = path.join(root, filePath);
    const currentContent = fs.readFileSync(fullPath, 'utf8');
    const previousContent = lastCommitState[filePath] || '';

    if (currentContent !== previousContent) {
      output += `diff --dep a/${filePath} b/${filePath}\n`;

      const prevLines = previousContent.split('\n');
      const currLines = currentContent.split('\n');

      // Simple line-by-line comparison

      for (const line of prevLines) {
        if (!currLines.includes(line)) {
          output += `- ${line}\n`;
        }
      }

      for (const line of currLines) {
        if (!prevLines.includes(line)) {
          output += `+ ${line}\n`;
        }
      }
      output += '\n';
    }
  }

  const stagePath = path.join(depPath, 'stage.json');

  if (fs.existsSync(stagePath)) {
    output += `--- Staged Changes ---\n`;
    const stage = JSON.parse(fs.readFileSync(stagePath, 'utf8'));
    for (const stagedFile of Object.keys(stage.changes)) {
      output += `staged: ${stagedFile}\n`;
    }
  }

  return output || 'No changes detected.';
}

module.exports = {
  __libraryVersion: '0.0.1',
  __libraryAPIName: 'Changes',
  log,
  diff
};
