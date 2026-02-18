/**
 * dep - Modern version control.
 * Module: Caches (v0.1.4)
 */

const fs = require('fs');
const path = require('path');

const { checkout } = require('../branching/index.js');
const getStateByHash = require('../utils/getStateByHash');

/**
 * Moves stage.json to a cache folder, or restores the most recent stash.
 * @param {object} options - Configuration for the stash operation.
 * @param {boolean} options.pop - Whether to restore and remove the latest stash.
 * @returns {string} Result message.
 */

 function stash ({ pop = false, list = false } = {}) {
   const root = process.cwd();
   const depPath = path.join(root, '.dep');
   const stagePath = path.join(depPath, 'stage.json');
   const cachePath = path.join(depPath, 'cache');
   const depJsonPath = path.join(depPath, 'dep.json');

   if (list) {
     if (!fs.existsSync(cachePath)) return [];

     const stashFiles = fs.readdirSync(cachePath)
       .filter(f => f.startsWith('stash_') && f.endsWith('.json'))
       .sort();

     const stashList = [];

     for (const [index, file] of stashFiles.entries()) {
       const ms = file.replace('stash_', '').replace('.json', '');

       stashList.push({
         id: `stash@{${stashFiles.length - 1 - index}}`,
         date: new Date(parseInt(ms)).toLocaleString(),
         file
       });
     }

     return stashList;
   }

   if (pop) {
     if (!fs.existsSync(cachePath)) throw new Error('No stashes found.');

     const stashes = fs.readdirSync(cachePath)
       .filter(f => f.startsWith('stash_') && f.endsWith('.json'))
       .sort();

     if (stashes.length === 0) throw new Error('No stashes found.');

     const latestStashName = stashes[stashes.length - 1];
     const latestStashPath = path.join(cachePath, latestStashName);
     const stashData = JSON.parse(fs.readFileSync(latestStashPath, 'utf8'));

     for (const [filePath, change] of Object.entries(stashData.changes)) {
       const fullPath = path.join(root, filePath);

       if (change.type === 'createFile' || change.type === 'update') {
         fs.mkdirSync(path.dirname(fullPath), { recursive: true });
         fs.writeFileSync(fullPath, change.content);
       } else if (change.type === 'deleteFile') {
         if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
       }
     }

     fs.unlinkSync(latestStashPath);

     return `Restored changes from ${latestStashName}.`;
   }

   const depJson = JSON.parse(fs.readFileSync(depJsonPath, 'utf8'));
   const activeState = getStateByHash(depJson.active.branch, depJson.active.parent) || {};

   const allWorkDirFiles = fs.readdirSync(root, { recursive: true })
     .filter(f => !f.startsWith('.dep') && !fs.statSync(path.join(root, f)).isDirectory());

   const stashChanges = {};

   for (const file of allWorkDirFiles) {
     const currentContent = fs.readFileSync(path.join(root, file), 'utf8');

     if (currentContent !== activeState[file]) {
       stashChanges[file] = { type: 'createFile', content: currentContent };
     }
   }

   for (const file in activeState) {
     if (!fs.existsSync(path.join(root, file))) {
       stashChanges[file] = { type: 'deleteFile' };
     }
   }

   if (Object.keys(stashChanges).length === 0) {
     return 'No local changes to stash.';
   }

   if (!fs.existsSync(cachePath)) fs.mkdirSync(cachePath, { recursive: true });

   const timestamp = Date.now();
   const stashFilePath = path.join(cachePath, `stash_${timestamp}.json`);

   fs.writeFileSync(stashFilePath, JSON.stringify({ changes: stashChanges }, null, 2));

   if (fs.existsSync(stagePath)) fs.unlinkSync(stagePath);

   checkout(depJson.active.branch);

   return `Cached working directory changes in stash_${timestamp}.`;
 }

/**
 * Wipes the stage and moves the active parent pointer if a hash is provided.
 */

function reset (hash) {
  const depPath = path.join(process.cwd(), '.dep');
  const stagePath = path.join(depPath, 'stage.json');
  const depJsonPath = path.join(depPath, 'dep.json');

  if (fs.existsSync(stagePath)) {
    fs.unlinkSync(stagePath);
  }

  if (!hash) {
    return 'Staging area cleared.';
  }

  const depJson = JSON.parse(fs.readFileSync(depJsonPath, 'utf8'));
  const branch = depJson.active.branch;
  const branchPath = path.join(depPath, 'history/local', branch);
  const commitPath = path.join(branchPath, `${hash}.json`);

  if (!fs.existsSync(commitPath)) {
    throw new Error(`Commit ${hash} not found in branch ${branch}.`);
  }

  depJson.active.parent = hash;
  fs.writeFileSync(depJsonPath, JSON.stringify(depJson, null, 2));

  const manifestPath = path.join(branchPath, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const hashIndex = manifest.commits.indexOf(hash);

  if (hashIndex !== -1) {
    manifest.commits = manifest.commits.slice(0, hashIndex + 1);
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  }

  checkout(branch);

  return `Head is now at ${hash.slice(0, 7)}. Working directory updated.`;
}

/**
 * Marks a file for deletion by adding a "deleteFile" entry to the stage.
 */

function rm (filePath) {
  const depPath = path.join(process.cwd(), '.dep');
  const stagePath = path.join(depPath, 'stage.json');
  const fullPath = path.join(process.cwd(), filePath);

  let stage = { changes: {} };

  if (fs.existsSync(stagePath)) {
    stage = JSON.parse(fs.readFileSync(stagePath, 'utf8'));
  }

  stage.changes[filePath] = {
    type: 'deleteFile'
  };

  fs.writeFileSync(stagePath, JSON.stringify(stage, null, 2));

  if (fs.existsSync(fullPath)) {
    fs.unlinkSync(fullPath);
  }

  return `File ${filePath} marked for removal.`;
}

module.exports = {
  __libraryVersion: '0.1.4',
  __libraryAPIName: 'Caches',
  stash,
  reset,
  rm
};
