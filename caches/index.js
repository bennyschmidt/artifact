/**
 * art - Modern version control.
 * Module: Caches (v0.3.2)
 */

const fs = require('fs');
const path = require('path');

const { checkout } = require('../branching/index.js');
const getStateByHash = require('../utils/getStateByHash');

const MAX_PART_SIZE = 32000000;

/**
 * Helper to load all changes from a paginated directory (Stage or Stash).
 */

function getPaginatedChanges (dirPath) {
  const manifestPath = path.join(dirPath, 'manifest.json');

  if (!fs.existsSync(dirPath) || !fs.existsSync(manifestPath)) {
    return {};
  }

  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

  let allChanges = {};

  for (const partName of manifest.parts) {
    const partPath = path.join(dirPath, partName);

    if (fs.existsSync(partPath)) {
      const partData = JSON.parse(fs.readFileSync(partPath, 'utf8'));

      Object.assign(allChanges, partData.changes);
    }
  }

  return allChanges;
}

/**
 * Helper to write changes to a paginated directory.
 */

function savePaginatedChanges (dirPath, changes) {
  if (fs.existsSync(dirPath)) {
    fs.rmSync(dirPath, { recursive: true, force: true });
  }

  fs.mkdirSync(dirPath, { recursive: true });

  const parts = [];

  let currentPartChanges = {};
  let currentSize = 0;

  const savePart = () => {
    if (Object.keys(currentPartChanges).length === 0) return;

    const partName = `part.${parts.length}.json`;

    fs.writeFileSync(path.join(dirPath, partName), JSON.stringify({ changes: currentPartChanges }, null, 2));
    parts.push(partName);
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
  fs.writeFileSync(path.join(dirPath, 'manifest.json'), JSON.stringify({ parts }, null, 2));
}

function stash ({ pop = false, list = false } = {}) {
  const root = process.cwd();
  const artPath = path.join(root, '.art');
  const stageDir = path.join(artPath, 'stage');
  const cachePath = path.join(artPath, 'cache');
  const artJsonPath = path.join(artPath, 'art.json');

  if (list) {
    if (!fs.existsSync(cachePath)) return [];

    const stashDirs = fs.readdirSync(cachePath)
      .filter(d => d.startsWith('stash_') && fs.statSync(path.join(cachePath, d)).isDirectory())
      .sort();

    return stashDirs.map((dirName, index) => ({
      id: `stash@{${stashDirs.length - 1 - index}}`,
      date: new Date(parseInt(dirName.replace('stash_', ''))).toLocaleString(),
      dirName
    }));
  }

  if (pop) {
    if (!fs.existsSync(cachePath)) throw new Error('No stashes found.');

    const stashes = fs.readdirSync(cachePath)
      .filter(d => d.startsWith('stash_') && fs.statSync(path.join(cachePath, d)).isDirectory())
      .sort();

    if (stashes.length === 0) throw new Error('No stashes found.');

    const latestStashDirName = stashes[stashes.length - 1];
    const latestStashPath = path.join(cachePath, latestStashDirName);
    const stashChanges = getPaginatedChanges(latestStashPath);

    for (const [filePath, changeSet] of Object.entries(stashChanges)) {
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

    fs.rmSync(latestStashPath, { recursive: true, force: true });
    return `Restored changes from ${latestStashDirName}.`;
  }

  const artJson = JSON.parse(fs.readFileSync(artJsonPath, 'utf8'));
  const activeState = getStateByHash(artJson.active.branch, artJson.active.parent) || {};

  const allWorkDirFiles = fs.readdirSync(root, { recursive: true })
    .filter(f => !f.startsWith('.art') && !fs.statSync(path.join(root, f)).isDirectory());

  const stashChanges = {};

  for (const file of allWorkDirFiles) {
    const fullPath = path.join(root, file);
    const currentBuffer = fs.readFileSync(fullPath);
    const isBinary = currentBuffer.includes(0);

    const currentContent = isBinary ? null : currentBuffer.toString('utf8');
    const previousContent = activeState[file];

    if (previousContent === undefined) {
      stashChanges[file] = { type: 'createFile', content: isBinary ? currentBuffer.toString('base64') : currentContent };
    } else if (currentContent !== previousContent && !isBinary) {
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

      if (ops.length > 0) {
        stashChanges[file] = ops;
      }
    }
  }

  for (const file in activeState) {
    if (!fs.existsSync(path.join(root, file))) {
      stashChanges[file] = { type: 'deleteFile' };
    }
  }

  if (Object.keys(stashChanges).length === 0) return 'No local changes to stash.';

  const timestamp = Date.now();
  const newStashPath = path.join(cachePath, `stash_${timestamp}`);

  savePaginatedChanges(newStashPath, stashChanges);

  if (fs.existsSync(stageDir)) {
    fs.rmSync(stageDir, { recursive: true, force: true });
  }

  checkout(artJson.active.branch, { force: true });

  return `Saved working directory changes to stash_${timestamp} and reverted to clean state.`;
}

function reset (hash) {
  const artPath = path.join(process.cwd(), '.art');
  const stageDir = path.join(artPath, 'stage');
  const artJsonPath = path.join(artPath, 'art.json');

  if (fs.existsSync(stageDir)) {
    fs.rmSync(stageDir, { recursive: true, force: true });
  }

  if (!hash) return 'Staging area cleared.';

  const artJson = JSON.parse(fs.readFileSync(artJsonPath, 'utf8'));
  const branch = artJson.active.branch;
  const branchPath = path.join(artPath, 'history/local', branch);
  const commitPath = path.join(branchPath, `${hash}.json`);

  if (!fs.existsSync(commitPath)) throw new Error(`Commit ${hash} not found in branch ${branch}.`);

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

  return `Branch is now at ${hash.slice(0, 7)}. Working directory updated.`;
}

function rm (filePath) {
  const artPath = path.join(process.cwd(), '.art');
  const fullPath = path.join(process.cwd(), filePath);
  const stage = getPaginatedChanges(path.join(artPath, 'stage'));

  stage[filePath] = { type: 'deleteFile' };
  savePaginatedChanges(path.join(artPath, 'stage'), stage);

  if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);

  return `File ${filePath} marked for removal.`;
}

module.exports = {
  __libraryVersion: '0.3.2',
  __libraryAPIName: 'Caches',
  stash,
  reset,
  rm
};
