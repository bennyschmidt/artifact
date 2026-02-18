/**
 * dep - Modern version control.
 * Module: Workflow (v0.1.1)
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

/**
 * Compares the working directory against the last commit and pending stage.
 */

function status() {
  const root = process.cwd();
  const depPath = path.join(root, '.dep');
  const depJsonPath = path.join(depPath, 'dep.json');

  if (!fs.existsSync(depJsonPath)) {
    throw new Error('No dep repository found.');
  }

  const depJson = JSON.parse(fs.readFileSync(depJsonPath, 'utf8'));
  const activeBranch = depJson.active.branch;
  const stagePath = path.join(depPath, 'stage.json');

  let stagedFiles = {};

  if (fs.existsSync(stagePath)) {
    stagedFiles = JSON.parse(fs.readFileSync(stagePath, 'utf8')).changes;
  }

  const getStateByHash = require('../utils/getStateByHash');
  const activeState = getStateByHash(activeBranch, depJson.active.parent) || {};

  const allWorkDirFiles = fs.readdirSync(root, { recursive: true })
    .filter(f => !f.startsWith('.dep') && !fs.statSync(path.join(root, f)).isDirectory());

  const untracked = [];
  const modified = [];

  for (const file of allWorkDirFiles) {
    const isStaged = !!stagedFiles[file];
    const isActive = !!activeState[file];

    if (!isStaged && !isActive) {
      untracked.push(file);
    } else if (!isStaged && isActive) {
      const currentContent = fs.readFileSync(path.join(root, file), 'utf8');

      if (currentContent !== activeState[file]) {
        modified.push(file);
      }
    }
  }

  return {
    activeBranch,
    lastCommit: depJson.active.parent,
    staged: Object.keys(stagedFiles),
    modified,
    untracked
  };
}

/**
 * Updates or creates a JSON diff in the stage.json file.
 * @param {string} filePath - Path of the file to add.
 * @returns {string} Confirmation message.
 */

 function add (targetPath) {
   const root = process.cwd();
   const depPath = path.join(root, '.dep');
   const stagePath = path.join(depPath, 'stage.json');
   const fullPath = path.resolve(root, targetPath);

   if (!fs.existsSync(fullPath)) {
     throw new Error(`Path does not exist: ${targetPath}`);
   }

   let stage = { changes: {} };

   if (fs.existsSync(stagePath)) {
     stage = JSON.parse(fs.readFileSync(stagePath, 'utf8'));
   }

   const stats = fs.statSync(fullPath);

   let filesToProcess = [];

   if (stats.isDirectory()) {
     filesToProcess = fs.readdirSync(fullPath, { recursive: true })
       .filter(f => {
         const absoluteF = path.join(fullPath, f);

         return !fs.statSync(absoluteF).isDirectory() && !absoluteF.includes('.dep');
       })
       .map(f => {
         const absoluteF = path.join(fullPath, f);

         return path.relative(root, absoluteF);
       });
   } else {
     filesToProcess = [path.relative(root, fullPath)];
   }

   filesToProcess.forEach(relPath => {
     const content = fs.readFileSync(path.join(root, relPath), 'utf8');

     stage.changes[relPath] = {
       type: 'createFile',
       content: content
     };
   });

   fs.writeFileSync(stagePath, JSON.stringify(stage, null, 2));

   return `Added ${filesToProcess.length} file(s) to stage.`;
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

  fs.writeFileSync(commitFilePath, JSON.stringify(commitObject, null, 2));

  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

  manifest.commits.push(hash);
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

  depJson.active.parent = hash;
  fs.writeFileSync(depJsonPath, JSON.stringify(depJson, null, 2));
  fs.unlinkSync(stagePath);

  return `[${branch} ${hash.slice(0, 7)}] ${message}`;
}

module.exports = {
  __libraryVersion: '0.1.1',
  __libraryAPIName: 'Workflow',
  status,
  add,
  commit
};
