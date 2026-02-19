/**
 * dep - Modern version control.
 * Module: Workflow (v0.2.3)
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

/**
 * Compares the working directory against the last commit and pending stage.
 */

function status () {
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
 * Implements character-precise position tracking.
 */

function add (targetPath) {
  const root = process.cwd();
  const depPath = path.join(root, '.dep');
  const stagePath = path.join(depPath, 'stage.json');
  const depJsonPath = path.join(depPath, 'dep.json');
  const fullPath = path.resolve(root, targetPath);

  if (!fs.existsSync(fullPath)) {
    throw new Error(`Path does not exist: ${targetPath}`);
  }

  let stage = { changes: {} };

  if (fs.existsSync(stagePath)) {
    stage = JSON.parse(fs.readFileSync(stagePath, 'utf8'));
  }

  const depJson = JSON.parse(fs.readFileSync(depJsonPath, 'utf8'));
  const getStateByHash = require('../utils/getStateByHash');
  const activeState = getStateByHash(depJson.active.branch, depJson.active.parent) || {};

  const stats = fs.statSync(fullPath);

  let filesToProcess = [];

  if (stats.isDirectory()) {
    filesToProcess = fs.readdirSync(fullPath, { recursive: true })
      .filter(f => {
        const absoluteF = path.join(fullPath, f);

        return !fs.statSync(absoluteF).isDirectory() && !absoluteF.includes('.dep');
      })
      .map(f => path.relative(root, path.join(fullPath, f)));
  } else {
    filesToProcess = [path.relative(root, fullPath)];
  }

  for (const relPath of filesToProcess) {
    const currentContent = fs.readFileSync(path.join(root, relPath), 'utf8');
    const previousContent = activeState[relPath];

    if (previousContent === undefined) {
      stage.changes[relPath] = {
        type: 'createFile',
        content: currentContent
      };

      continue;
    }

    if (currentContent !== previousContent) {
      const operations = [];

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

      const deletionLength = oldEnd - start + 1;

      if (deletionLength > 0) {
        operations.push({
          type: 'delete',
          position: start,
          length: deletionLength
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
        stage.changes[relPath] = operations;
      }
    }
  }

  fs.writeFileSync(stagePath, JSON.stringify(stage, null, 2));

  return `Added ${filesToProcess.length} file(s) to stage.`;
}

/**
 * Finalizes the stage into a commit file.
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
    hash,
    message,
    timestamp,
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
  __libraryVersion: '0.2.3',
  __libraryAPIName: 'Workflow',
  status,
  add,
  commit
};
