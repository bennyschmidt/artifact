/**
 * art - Modern version control.
 * Module: Workflow (v0.3.1)
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const getStateByHash = require('../utils/getStateByHash');
const shouldIgnore = require('../utils/shouldIgnore');

const MAX_PART_SIZE = 32000000;

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
 * Compares the working directory against the last commit and pending stage.
 */

function status () {
  const root = process.cwd();
  const artPath = path.join(root, '.art');
  const artJsonPath = path.join(artPath, 'art.json');

  if (!fs.existsSync(artJsonPath)) {
    throw new Error('No art repository found.');
  }

  const artJson = JSON.parse(fs.readFileSync(artJsonPath, 'utf8'));
  const activeBranch = artJson.active.branch;

  const stagedFiles = getStagedChanges(artPath);
  const activeState = getStateByHash(activeBranch, artJson.active.parent) || {};

  const allFiles = fs.readdirSync(root, { recursive: true })
    .filter(f => !fs.statSync(path.join(root, f)).isDirectory());

  const untracked = [];
  const modified = [];
  const ignored = [];

  for (const file of allFiles) {
    const isStaged = !!stagedFiles[file];
    const isActive = !!activeState[file];

    if (file === '.art' || file.startsWith(`.art${path.sep}`)) continue;

    const isIgnored = shouldIgnore(file);

    if (isIgnored && !isActive && !isStaged) {
      ignored.push(file);

      continue;
    }

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
    lastCommit: artJson.active.parent,
    staged: Object.keys(stagedFiles),
    modified,
    untracked,
    ignored
  };
}

/**
 * Updates or creates a JSON diff in the stage directory.
 */

 function add (targetPath) {
   const root = process.cwd();
   const artPath = path.join(root, '.art');
   const stageDir = path.join(artPath, 'stage');
   const artJsonPath = path.join(artPath, 'art.json');
   const fullPath = path.resolve(root, targetPath);

   if (!fs.existsSync(fullPath)) {
     throw new Error(`Path does not exist: ${targetPath}`);
   }

   const artJson = JSON.parse(fs.readFileSync(artJsonPath, 'utf8'));
   const activeState = getStateByHash(artJson.active.branch, artJson.active.parent) || {};
   const currentStaged = getStagedChanges(artPath);

   const stats = fs.statSync(fullPath);
   const relativeTarget = path.relative(root, fullPath);

   if (!stats.isDirectory() && shouldIgnore(relativeTarget) && !activeState[relativeTarget]) {
     return `${relativeTarget} is being ignored.`;
   }

   let filesToProcess = [];

   if (stats.isDirectory()) {
     filesToProcess = fs.readdirSync(fullPath, { recursive: true })
       .filter(f => {
         const absF = path.join(fullPath, f);
         const relF = path.relative(root, absF);

         return !fs.statSync(absF).isDirectory() && !relF.startsWith('.art') && (!shouldIgnore(relF) || !!activeState[relF]);
       })
       .map(f => path.relative(root, path.join(fullPath, f)));
   } else {
     filesToProcess = [relativeTarget];
   }

   if (filesToProcess.length === 0) return "No changes to add.";

   for (const relPath of filesToProcess) {
     const currentContent = fs.readFileSync(path.join(root, relPath), 'utf8');
     const previousContent = activeState[relPath];

     if (previousContent === undefined) {
       currentStaged[relPath] = { type: 'createFile', content: currentContent };
     } else if (currentContent !== previousContent) {
       let start = 0;

       while (start < previousContent.length && start < currentContent.length && previousContent[start] === currentContent[start]) {
         start++;
       }

       let oldEnd = previousContent.length - 1;
       let newEnd = currentContent.length - 1;

       while (oldEnd >= start && newEnd >= start && previousContent[oldEnd] === currentContent[newEnd]) {
         oldEnd--; newEnd--;
       }

       const operations = [];
       const deletionLength = oldEnd - start + 1;

       if (deletionLength > 0) {
         operations.push({
           type: 'delete',
           position: start,
           length: deletionLength,
           content: previousContent.slice(start, oldEnd + 1)
         });
       }

       const insertionContent = currentContent.slice(start, newEnd + 1);

       if (insertionContent.length > 0) {
         operations.push({ type: 'insert', position: start, content: insertionContent });
       }

       if (operations.length > 0) {
         currentStaged[relPath] = operations;
       }
     }
   }

   if (fs.existsSync(stageDir)) fs.rmSync(stageDir, { recursive: true, force: true });

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

   for (const [file, changes] of Object.entries(currentStaged)) {
     const size = JSON.stringify(changes).length;

     if (currentSize + size > MAX_PART_SIZE && Object.keys(currentPartChanges).length > 0) {
       savePart();
     }

     currentPartChanges[file] = changes;
     currentSize += size;
   }

   savePart();

   fs.writeFileSync(path.join(stageDir, 'manifest.json'), JSON.stringify({ parts: stageParts }, null, 2));

   return `Added ${filesToProcess.length} file(s) to stage.`;
 }

/**
 * Finalizes the paginated stage into a paginated commit structure.
 */

function commit (message) {
  if (!message) throw new Error('A commit message is required.');

  const MAX_PART_SIZE = 32000000;
  const artPath = path.join(process.cwd(), '.art');
  const stageDir = path.join(artPath, 'stage');
  const artJsonPath = path.join(artPath, 'art.json');

  if (!fs.existsSync(stageDir)) throw new Error('Nothing to commit (stage is empty).');

  const stagedChanges = getStagedChanges(artPath);
  const artJson = JSON.parse(fs.readFileSync(artJsonPath, 'utf8'));
  const branch = artJson.active.branch;
  const timestamp = Date.now();

  const commitHash = crypto
    .createHash('sha1')
    .update(JSON.stringify(stagedChanges) + timestamp + message)
    .digest('hex');

  const branchHistoryDir = path.join(artPath, 'history', 'local', branch);
  const commitParts = [];

  let currentPartChanges = {};
  let currentPartSize = 0;

  const saveCommitPart = () => {
    if (Object.keys(currentPartChanges).length === 0) return;

    const partName = `${commitHash}.part.${commitParts.length}.json`;

    fs.writeFileSync(path.join(branchHistoryDir, partName), JSON.stringify({ changes: currentPartChanges }, null, 2));
    commitParts.push(partName);

    currentPartChanges = {};
    currentPartSize = 0;
  };

  for (const [filePath, changeSet] of Object.entries(stagedChanges)) {
    const changeSize = JSON.stringify(changeSet).length;

    if (currentPartSize + changeSize > MAX_PART_SIZE && Object.keys(currentPartChanges).length > 0) {
      saveCommitPart();
    }

    currentPartChanges[filePath] = changeSet;
    currentPartSize += changeSize;
  }
  saveCommitPart();

  const commitMaster = {
    hash: commitHash,
    message,
    timestamp,
    parent: artJson.active.parent,
    parts: commitParts
  };

  fs.writeFileSync(path.join(branchHistoryDir, `${commitHash}.json`), JSON.stringify(commitMaster, null, 2));

  const manifest = JSON.parse(fs.readFileSync(path.join(branchHistoryDir, 'manifest.json'), 'utf8'));

  manifest.commits.push(commitHash);
  fs.writeFileSync(path.join(branchHistoryDir, 'manifest.json'), JSON.stringify(manifest, null, 2));

  artJson.active.parent = commitHash;
  fs.writeFileSync(artJsonPath, JSON.stringify(artJson, null, 2));

  fs.rmSync(stageDir, { recursive: true, force: true });

  return `[${branch} ${commitHash.slice(0, 7)}] ${message} (${commitParts.length} parts)`;
}

module.exports = {
  __libraryVersion: '0.3.1',
  __libraryAPIName: 'Workflow',
  status,
  add,
  commit
};
