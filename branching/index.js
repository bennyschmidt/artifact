/**
 * dep - Efficient version control.
 * Module: Branching (v0.0.6)
 */

const fs = require('fs');
const path = require('path');

const getStateByHash = require('../utils/getStateByHash');

/**
 * Lists, creates, or deletes branches.
 */
 
function branch (name) {
  const depPath = path.join(process.cwd(), '.dep');
  const localHistoryPath = path.join(depPath, 'history/local');
  const remoteHistoryPath = path.join(depPath, 'history/remote');

  if (!name) {
    return fs.readdirSync(localHistoryPath);
  }

  const branchLocalPath = path.join(localHistoryPath, name);
  const branchRemotePath = path.join(remoteHistoryPath, name);

  if (fs.existsSync(branchLocalPath)) {
    throw new Error(`Branch "${name}" already exists locally.`);
  }

  fs.mkdirSync(branchLocalPath, { recursive: true });

  fs.writeFileSync(
    path.join(branchLocalPath, 'manifest.json'),
    JSON.stringify({ commits: [] }, null, 2)
  );

  if (!fs.existsSync(branchRemotePath)) {
    fs.mkdirSync(branchRemotePath, { recursive: true });

    fs.writeFileSync(
      path.join(branchRemotePath, 'manifest.json'),
      JSON.stringify({ commits: [] }, null, 2)
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
    branch(branchName);
  }

  const depJson = JSON.parse(fs.readFileSync(depJsonPath, 'utf8'));
  const targetState = getStateByHash(branchName, null);

  const currentFiles = fs.readdirSync(process.cwd()).filter(f => f !== '.dep');

  for (const f of currentFiles) {
    fs.rmSync(path.join(process.cwd(), f), { recursive: true, force: true });
  }

  for (const [filePath, content] of Object.entries(targetState)) {
    const fullPath = path.join(process.cwd(), filePath);

    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, content);
  }

  const manifest = JSON.parse(fs.readFileSync(path.join(branchPath, 'manifest.json'), 'utf8'));

  depJson.active.branch = branchName;
  depJson.active.parent = manifest.commits.length > 0 ? manifest.commits[manifest.commits.length - 1] : null;

  fs.writeFileSync(depJsonPath, JSON.stringify(depJson, null, 2));

  return `Switched to branch "${branchName}".`;
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
  __libraryVersion: '0.0.6',
  __libraryAPIName: 'Branching',
  branch,
  checkout,
  merge
};
