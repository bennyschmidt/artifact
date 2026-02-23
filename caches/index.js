/**
 * art - Modern version control.
 * Module: Caches (v0.2.9)
 */

const fs = require('fs');
const path = require('path');

const { checkout } = require('../branching/index.js');
const getStateByHash = require('../utils/getStateByHash');

/**
 * Helper to load all changes from a paginated stage directory.
 */

function getStagedChanges(artPath) {
  const stageDir = path.join(artPath, 'stage');
  const manifestPath = path.join(stageDir, 'manifest.json');

  if (!fs.existsSync(stageDir) || !fs.existsSync(manifestPath)) {
    return {};
  }

  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

  let allChanges = {};

  for (const partName of manifest.parts) {
    const partPath = path.join(stageDir, partName);

    if (fs.existsSync(partPath)) {
      const partData = JSON.parse(fs.readFileSync(partPath, 'utf8'));

      Object.assign(allChanges, partData.changes);
    }
  }

  return allChanges;
}

/**
 * Helper to write changes to a paginated stage directory.
 */

function saveStagedChanges(artPath, changes) {
  const MAX_PART_SIZE = 32000000;
  const stageDir = path.join(artPath, 'stage');

  if (fs.existsSync(stageDir)) {
    fs.rmSync(stageDir, { recursive: true, force: true });
  }

  fs.mkdirSync(stageDir, { recursive: true });

  const stageParts = [];

  let currentPartChanges = {};
  let currentSize = 0;

  const savePart = () => {
    const partName = `part.${stageParts.length}.json`;

    fs.writeFileSync(path.join(stageDir, partName), JSON.stringify({ changes: currentPartChanges }, null, 2));
    stageParts.push(partName);

    currentPartChanges = {};
    currentSize = 0;
  };

  for (const [file, changeSet] of Object.entries(changes)) {
    const size = JSON.stringify(changeSet).length;

    if (currentSize + size > MAX_PART_SIZE && Object.keys(currentPartChanges).length > 0) {
      savePart();
    }

    currentPartChanges[file] = changeSet;
    currentSize += size;
  }

  savePart();

  fs.writeFileSync(path.join(stageDir, 'manifest.json'), JSON.stringify({ parts: stageParts }, null, 2));
}

/**
 * Moves changes to a cache folder, or restores the most recent stash.
 */

function stash ({ pop = false, list = false } = {}) {
  const root = process.cwd();
  const artPath = path.join(root, '.art');
  const stageDir = path.join(artPath, 'stage');
  const cachePath = path.join(artPath, 'cache');
  const artJsonPath = path.join(artPath, 'art.json');

  if (list) {
    if (!fs.existsSync(cachePath)) return [];

    const stashFiles = fs.readdirSync(cachePath)
      .filter(f => f.startsWith('stash_') && f.endsWith('.json'))
      .sort();

    return stashFiles.map((file, index) => ({
      id: `stash@{${stashFiles.length - 1 - index}}`,
      date: new Date(parseInt(file.replace('stash_', '').replace('.json', ''))).toLocaleString(),
      file
    }));
  }

  if (pop) {
    if (!fs.existsSync(cachePath)) throw new Error('No stashes found.');

    const stashes = fs.readdirSync(cachePath)
      .filter(f => f.startsWith('stash_') && f.endsWith('.json'))
      .sort();

    if (stashes.length === 0) {
      throw new Error('No stashes found.');
    }

    const latestStashName = stashes[stashes.length - 1];
    const latestStashPath = path.join(cachePath, latestStashName);
    const stashData = JSON.parse(fs.readFileSync(latestStashPath, 'utf8'));

    for (const [filePath, changeSet] of Object.entries(stashData.changes)) {
      const fullPath = path.join(root, filePath);

      if (Array.isArray(changeSet)) {
        let content = fs.existsSync(fullPath) ? fs.readFileSync(fullPath, 'utf8') : '';

        for (const operation of changeSet) {
          if (operation.type === 'insert') {
            content = `${content.slice(0, operation.position)}${operation.content}${content.slice(operation.position)}`;
          } else if (operation.type === 'delete') {
            content = `${content.slice(0, operation.position)}${content.slice(operation.position + operation.length)}`;
          }
        }

        fs.writeFileSync(fullPath, content);
      } else if (changeSet.type === 'createFile') {
        fs.mkdirSync(path.dirname(fullPath), { recursive: true });
        fs.writeFileSync(fullPath, changeSet.content);
      } else if (changeSet.type === 'deleteFile') {
        if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
      }
    }

    fs.unlinkSync(latestStashPath);

    return `Restored changes from ${latestStashName}.`;
  }

  const artJson = JSON.parse(fs.readFileSync(artJsonPath, 'utf8'));
  const activeState = getStateByHash(artJson.active.branch, artJson.active.parent) || {};

  const allWorkDirFiles = fs.readdirSync(root, { recursive: true })
    .filter(f => !f.startsWith('.art') && !fs.statSync(path.join(root, f)).isDirectory());

  const stashChanges = {};

  for (const file of allWorkDirFiles) {
    const currentContent = fs.readFileSync(path.join(root, file), 'utf8');
    const previousContent = activeState[file];

    if (previousContent === undefined) {
      stashChanges[file] = { type: 'createFile', content: currentContent };
    } else if (currentContent !== previousContent) {
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

      const ops = [];
      const delLen = oldEnd - start + 1;

      if (delLen > 0) ops.push({ type: 'delete', position: start, length: delLen });

      const insCont = currentContent.slice(start, newEnd + 1);

      if (insCont.length > 0) ops.push({ type: 'insert', position: start, content: insCont });

      if (ops.length > 0) stashChanges[file] = ops;
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

  fs.writeFileSync(path.join(cachePath, `stash_${timestamp}.json`), JSON.stringify({ changes: stashChanges }, null, 2));

  if (fs.existsSync(stageDir)) {
    fs.rmSync(stageDir, { recursive: true, force: true });
  }

  checkout(artJson.active.branch, { force: true });

  return `Saved working directory changes to stash_${timestamp}.json and reverted to clean state.`;
}

/**
 * Wipes the stage and moves the active parent pointer if a hash is provided.
 */

function reset (hash) {
  const artPath = path.join(process.cwd(), '.art');
  const stageDir = path.join(artPath, 'stage');
  const artJsonPath = path.join(artPath, 'art.json');

  if (fs.existsSync(stageDir)) {
    fs.rmSync(stageDir, { recursive: true, force: true });
  }

  if (!hash) {
    return 'Staging area cleared.';
  }

  const artJson = JSON.parse(fs.readFileSync(artJsonPath, 'utf8'));
  const branch = artJson.active.branch;
  const branchPath = path.join(artPath, 'history/local', branch);
  const commitPath = path.join(branchPath, `${hash}.json`);

  if (!fs.existsSync(commitPath)) {
    throw new Error(`Commit ${hash} not found in branch ${branch}.`);
  }

  artJson.active.parent = hash;
  fs.writeFileSync(artJsonPath, JSON.stringify(artJson, null, 2));

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
  const artPath = path.join(process.cwd(), '.art');
  const fullPath = path.join(process.cwd(), filePath);

  const stage = getStagedChanges(artPath);

  stage[filePath] = {
    type: 'deleteFile'
  };

  saveStagedChanges(artPath, stage);

  if (fs.existsSync(fullPath)) {
    fs.unlinkSync(fullPath);
  }

  return `File ${filePath} marked for removal.`;
}

module.exports = {
  __libraryVersion: '0.2.9',
  __libraryAPIName: 'Caches',
  stash,
  reset,
  rm
};
