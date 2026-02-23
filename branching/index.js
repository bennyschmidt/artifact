/**
 * art - Modern version control.
 * Module: Branching (v0.2.8)
 */

const fs = require('fs');
const path = require('path');

const getStateByHash = require('../utils/getStateByHash');

/**
 * Lists, creates, or deletes branches.
 */

function branch ({ name, isDelete = false } = {}) {
  const artPath = path.join(process.cwd(), '.art');
  const localHistoryPath = path.join(artPath, 'history/local');
  const remoteHistoryPath = path.join(artPath, 'history/remote');
  const artJsonPath = path.join(artPath, 'art.json');

  if (!name) {
   return fs.readdirSync(localHistoryPath).filter(f => {
     return f !== '.DS_Store' && f !== 'desktop.ini' && f !== 'thumbs.db';
   });
  }

  const illegalRegExp = /[\/\\]/g;
  const controlRegExp = /[\x00-\x1f\x80-\x9f]/g;
  const reservedRegExp = /^\.+$/;

  if (illegalRegExp.test(name) || controlRegExp.test(name) || reservedRegExp.test(name)) {
    throw new Error(`Invalid branch name: "${name}". Branch names cannot contain slashes or illegal characters.`);
  }

  const branchLocalPath = path.join(localHistoryPath, name);
  const branchRemotePath = path.join(remoteHistoryPath, name);

  if (isDelete) {
    if (!fs.existsSync(branchLocalPath)) {
      throw new Error(`Local branch "${name}" does not exist.`);
    }

    const artJson = JSON.parse(fs.readFileSync(artJsonPath, 'utf8'));

    if (artJson.active.branch === name) {
      throw new Error(`Local branch "${name}" is in use and can't be deleted right now.`);
    }

    fs.rmSync(branchLocalPath, { recursive: true, force: true });

    if (fs.existsSync(branchRemotePath)) {
      fs.rmSync(branchRemotePath, { recursive: true, force: true });
    }

    return `Deleted local branch "${name}".`;
  }

  if (fs.existsSync(branchLocalPath)) {
    throw new Error(`Local branch "${name}" already exists.`);
  }

  const artJson = JSON.parse(fs.readFileSync(artJsonPath, 'utf8'));
  const currentBranchManifest = path.join(localHistoryPath, artJson.active.branch, 'manifest.json');

  let initialCommits = [];

  if (fs.existsSync(currentBranchManifest)) {
    initialCommits = JSON.parse(fs.readFileSync(currentBranchManifest, 'utf8')).commits;
  }

  fs.mkdirSync(branchLocalPath, { recursive: true });

  fs.writeFileSync(
    path.join(branchLocalPath, 'manifest.json'),
    JSON.stringify({ commits: initialCommits }, null, 2)
  );

  if (!fs.existsSync(branchRemotePath)) {
    fs.mkdirSync(branchRemotePath, { recursive: true });

    fs.writeFileSync(
      path.join(branchRemotePath, 'manifest.json'),
      JSON.stringify({ commits: initialCommits }, null, 2)
    );
  }

  if (initialCommits.length > 0) {
    const sourceBranchPath = path.join(localHistoryPath, artJson.active.branch);

    for (const hash of initialCommits) {
      const srcFile = path.join(sourceBranchPath, `${hash}.json`);
      const destFile = path.join(branchLocalPath, `${hash}.json`);

      if (fs.existsSync(srcFile)) {
        fs.copyFileSync(srcFile, destFile);
      }
    }
  }

  return `Created branch "${name}".`;
}

/**
 * Updates the active pointer and reconstructs the working directory.
 */

function checkout (branchName, { force = false } = {}) {
  const root = process.cwd();
  const artPath = path.join(root, '.art');
  const artJsonPath = path.join(artPath, 'art.json');
  const branchPath = path.join(artPath, 'history/local', branchName);

  if (!fs.existsSync(branchPath)) {
    branch({ name: branchName });
  }

  const artJson = JSON.parse(fs.readFileSync(artJsonPath, 'utf8'));
  const currentState = getStateByHash(artJson.active.branch, artJson.active.parent) || {};

  if (!force) {
    const allWorkDirFiles = fs.readdirSync(root, { recursive: true })
      .filter(f => !f.startsWith('.art') && !fs.statSync(path.join(root, f)).isDirectory());

    let isDirty = false;
    for (const file of allWorkDirFiles) {
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

  const manifest = JSON.parse(fs.readFileSync(path.join(branchPath, 'manifest.json'), 'utf8'));

  const targetHash = manifest.commits.length > 0
    ? manifest.commits[manifest.commits.length - 1]
    : null;

  const targetState = getStateByHash(branchName, targetHash);

  for (const filePath of Object.keys(currentState)) {
    if (!targetState[filePath]) {
      const fullPath = path.join(root, filePath);
      if (fs.existsSync(fullPath)) fs.rmSync(fullPath, { recursive: true, force: true });
    }
  }

  for (const [filePath, content] of Object.entries(targetState)) {
    const fullPath = path.join(root, filePath);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, content);
  }

  artJson.active.branch = branchName;
  artJson.active.parent = targetHash;
  fs.writeFileSync(artJsonPath, JSON.stringify(artJson, null, 2));

  return `Switched to branch "${branchName}".`;
}

/**
 * Performs a three-way merge. Overwrites working directory with conflicts.
 */

function merge (targetBranch) {
  const root = process.cwd();
  const artPath = path.join(root, '.art');
  const artJson = JSON.parse(fs.readFileSync(path.join(artPath, 'art.json'), 'utf8'));
  const activeBranch = artJson.active.branch;

  const activeManifest = JSON.parse(fs.readFileSync(path.join(artPath, `history/local/${activeBranch}/manifest.json`), 'utf8'));
  const targetManifest = JSON.parse(fs.readFileSync(path.join(artPath, `history/local/${targetBranch}/manifest.json`), 'utf8'));

  const commonAncestorHash = [...activeManifest.commits].reverse().find(h => targetManifest.commits.includes(h)) || null;

  const baseState = commonAncestorHash ? getStateByHash(activeBranch, commonAncestorHash) : {};
  const activeState = getStateByHash(activeBranch, artJson.active.parent);
  const lastTargetHash = targetManifest.commits[targetManifest.commits.length - 1];
  const targetState = getStateByHash(targetBranch, lastTargetHash);

  const mergedChanges = {};
  const allFiles = new Set([...Object.keys(activeState), ...Object.keys(targetState)]);

  for (const filePath of allFiles) {
    const base = baseState[filePath];
    const active = activeState[filePath];
    const target = targetState[filePath];
    const fullPath = path.join(root, filePath);

    if (active === target) continue;

    if (base === active && base !== target) {
      fs.mkdirSync(path.dirname(fullPath), { recursive: true });
      fs.writeFileSync(fullPath, target || '');

      mergedChanges[filePath] = { type: 'createFile', content: target };
    } else if (base !== active && base !== target && active !== target) {
      const conflictContent = `<<<<<<< active\n${active || ''}\n=======\n${target || ''}\n>>>>>>> ${targetBranch}`;

      fs.mkdirSync(path.dirname(fullPath), { recursive: true });
      fs.writeFileSync(fullPath, conflictContent);

      mergedChanges[filePath] = { type: 'createFile', content: conflictContent };
    }
  }

  const stage = { changes: mergedChanges };

  fs.writeFileSync(path.join(artPath, 'stage.json'), JSON.stringify(stage, null, 2));

  return `Merged ${targetBranch}. Conflicts written to the stage and working directory to be resolved.`;
}

module.exports = {
  __libraryVersion: '0.2.8',
  __libraryAPIName: 'Branching',
  branch,
  checkout,
  merge
};
