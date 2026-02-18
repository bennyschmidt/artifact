/**
 * dep - Simple version control
 * Module: Workflow (v0.0.1)
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

/**
 * Compares the working directory against the last commit and pending stage.
 * @returns {object} Status object containing branch info and change summaries.
 */

function status () {
  const depPath = path.join(process.cwd(), '.dep');
  const depJsonPath = path.join(depPath, 'dep.json');

  if (!fs.existsSync(depJsonPath)) {
    throw new Error('No dep repository found.');
  }

  const depJson = JSON.parse(fs.readFileSync(depJsonPath, 'utf8'));
  const stagePath = path.join(depPath, 'stage.json');

  let stagedFiles = [];

  if (fs.existsSync(stagePath)) {
    const stage = JSON.parse(fs.readFileSync(stagePath, 'utf8'));

    stagedFiles = Object.keys(stage.changes);
  }

  return {
    activeBranch: depJson.active.branch,
    lastCommit: depJson.active.parent,
    staged: stagedFiles
  };
}

/**
 * Updates or creates a JSON diff in the stage.json file.
 * @param {string} filePath - Path of the file to add.
 * @returns {string} Confirmation message.
 */

function add (filePath) {
  const depPath = path.join(process.cwd(), '.dep');
  const stagePath = path.join(depPath, 'stage.json');
  const fullPath = path.join(process.cwd(), filePath);

  if (!fs.existsSync(fullPath)) {
    throw new Error(`Path does not exist: ${filePath}`);
  }

  let stage = { changes: {} };

  if (fs.existsSync(stagePath)) {
    stage = JSON.parse(fs.readFileSync(stagePath, 'utf8'));
  }

  const content = fs.readFileSync(fullPath, 'utf8');

  // Currently records full content for the commit diff logic.
  // In our replay design, this is treated as a 'createFile' or 'update' operation.

  stage.changes[filePath] = {
    type: 'createFile',
    content: content
  };

  fs.writeFileSync(stagePath, JSON.stringify(stage, null, 2));

  return `Added ${filePath} to stage.`;
}

/**
 * Finalizes the stage into a commit file within the history directory.
 * @param {string} message - The commit message.
 * @returns {string} Confirmation message with the new hash.
 */

function commit (message) {
  if (!message) {
    throw new Error('A commit message is required.');
  }

  const depPath = path.join(process.cwd(), '.dep');
  const stagePath = path.join(depPath, 'stage.json');
  const depJsonPath = path.join(depPath, 'dep.json');

  if (!fs.existsSync(stagePath)) {
    throw new Error('Nothing to commit (stage is empty).');
  }

  const stage = JSON.parse(fs.readFileSync(stagePath, 'utf8'));
  const depJson = JSON.parse(fs.readFileSync(depJsonPath, 'utf8'));
  const branch = depJson.active.branch;

  const timestamp = Date.now();

  const hash = crypto
    .createHash('sha1')
    .update(JSON.stringify(stage.changes) + timestamp + message)
    .digest('hex');

  const commitObject = {
    hash: hash,
    message: message,
    timestamp: timestamp,
    parent: depJson.active.parent,
    changes: stage.changes
  };

  const branchHistoryDir = path.join(depPath, 'history', 'local', branch);
  const commitFilePath = path.join(branchHistoryDir, `${hash}.json`);
  const manifestPath = path.join(branchHistoryDir, 'manifest.json');

  // Write the commit file

  fs.writeFileSync(commitFilePath, JSON.stringify(commitObject, null, 2));

  // Update the branch manifest

  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

  manifest.commits.push(hash);
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

  // Update dep.json active pointer

  depJson.active.parent = hash;
  fs.writeFileSync(depJsonPath, JSON.stringify(depJson, null, 2));

  // Clear stage by deleting the file

  fs.unlinkSync(stagePath);

  return `[${branch} ${hash.slice(0, 7)}] ${message}`;
}

module.exports = {
  __libraryVersion: '0.0.1',
  __libraryAPIName: 'Workflow',
  status,
  add,
  commit
};
