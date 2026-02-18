/**
 * dep - Modern version control.
 * Module: Branching (v0.1.2)
 */

const fs = require('fs');
const path = require('path');

const getStateByHash = require('../utils/getStateByHash');

/**
 * Lists, creates, or deletes branches.
 */

function branch ({ name, isDelete = false } = {}) {
  const depPath = path.join(process.cwd(), '.dep');
  const localHistoryPath = path.join(depPath, 'history/local');
  const remoteHistoryPath = path.join(depPath, 'history/remote');
  const depJsonPath = path.join(depPath, 'dep.json');

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

    const depJson = JSON.parse(fs.readFileSync(depJsonPath, 'utf8'));

    if (depJson.active.branch === name) {
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

  const depJson = JSON.parse(fs.readFileSync(depJsonPath, 'utf8'));
  const currentBranchManifest = path.join(localHistoryPath, depJson.active.branch, 'manifest.json');

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

  return `Created branch "${name}".`;
}

/**
 * Updates the active pointer and reconstructs the working directory.
 */

 function checkout (branchName) {
   const depPath = path.join(process.cwd(), '.dep');
   const depJsonPath = path.join(depPath, 'dep.json');
   const branchPath = path.join(depPath, 'history/local', branchName);

   if (!fs.existsSync(branchPath)) {
     branch({ name: branchName });
   }

   const depJson = JSON.parse(fs.readFileSync(depJsonPath, 'utf8'));
   const targetState = getStateByHash(branchName, null);
   const currentState = getStateByHash(depJson.active.branch, depJson.active.parent) || {};

   for (const filePath of Object.keys(currentState)) {
     if (!targetState[filePath]) {
       const fullPath = path.join(process.cwd(), filePath);

       if (fs.existsSync(fullPath)) {
         fs.rmSync(fullPath, { recursive: true, force: true });
       }
     }
   }

   for (const [filePath, content] of Object.entries(targetState)) {
     const fullPath = path.join(process.cwd(), filePath);

     fs.mkdirSync(path.dirname(fullPath), { recursive: true });
     fs.writeFileSync(fullPath, content);
   }

   const manifest = JSON.parse(fs.readFileSync(path.join(branchPath, 'manifest.json'), 'utf8'));

   depJson.active.branch = branchName;

   depJson.active.parent = manifest.commits.length > 0
    ? manifest.commits[manifest.commits.length - 1]
    : null;

   fs.writeFileSync(depJsonPath, JSON.stringify(depJson, null, 2));

   return `Switched to branch "${branchName}". Unstaged changes preserved.`;
 }

/**
 * Performs a three-way merge. Overwrites working directory with conflicts.
 */

function merge (targetBranch) {
  const root = process.cwd();
  const depPath = path.join(root, '.dep');
  const depJson = JSON.parse(fs.readFileSync(path.join(depPath, 'dep.json'), 'utf8'));
  const activeBranch = depJson.active.branch;

  const activeManifest = JSON.parse(fs.readFileSync(path.join(depPath, `history/local/${activeBranch}/manifest.json`), 'utf8'));
  const targetManifest = JSON.parse(fs.readFileSync(path.join(depPath, `history/local/${targetBranch}/manifest.json`), 'utf8'));

  const commonAncestorHash = [...activeManifest.commits].reverse().find(h => targetManifest.commits.includes(h)) || null;

  const baseState = commonAncestorHash ? getStateByHash(activeBranch, commonAncestorHash) : {};
  const activeState = getStateByHash(activeBranch, depJson.active.parent);
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

  fs.writeFileSync(path.join(depPath, 'stage.json'), JSON.stringify(stage, null, 2));

  return `Merged ${targetBranch}. Conflicts written to the stage and working directory to be resolved.`;
}

module.exports = {
  __libraryVersion: '0.1.2',
  __libraryAPIName: 'Branching',
  branch,
  checkout,
  merge
};
