/**
 * art - Modern version control.
 * Module: Workflow (v0.2.6)
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const getStateByHash = require('../utils/getStateByHash');
const shouldIgnore = require('../utils/shouldIgnore');

/**
 * Compares the working directory against the last commit and pending stage.
 */

 function status() {
  const root = process.cwd();
  const artPath = path.join(root, '.art');
  const artJsonPath = path.join(artPath, 'art.json');
  const shouldIgnore = require('../utils/shouldIgnore');
  const getStateByHash = require('../utils/getStateByHash');

  if (!fs.existsSync(artJsonPath)) {
    throw new Error('No art repository found.');
  }

  const artJson = JSON.parse(fs.readFileSync(artJsonPath, 'utf8'));
  const activeBranch = artJson.active.branch;
  const stagePath = path.join(artPath, 'stage.json');

  let stagedFiles = {};
  if (fs.existsSync(stagePath)) {
    stagedFiles = JSON.parse(fs.readFileSync(stagePath, 'utf8')).changes;
  }

  const activeState = getStateByHash(activeBranch, artJson.active.parent) || {};

  const allFiles = fs.readdirSync(root, { recursive: true })
    .filter(f => !fs.statSync(path.join(root, f)).isDirectory());

  const untracked = [];
  const modified = [];
  const ignored = [];

  for (const file of allFiles) {
    const isStaged = !!stagedFiles[file];
    const isActive = !!activeState[file];

    if (file === '.art' || file.startsWith(`.art${path.sep}`)) {
      continue;
    }

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
 * Updates or creates a JSON diff in the stage.json file.
 * Implements character-precise position tracking.
 */

 function add (targetPath) {
   const root = process.cwd();
   const artPath = path.join(root, '.art');
   const stagePath = path.join(artPath, 'stage.json');
   const artJsonPath = path.join(artPath, 'art.json');
   const fullPath = path.resolve(root, targetPath);

   if (!fs.existsSync(fullPath)) {
     throw new Error(`Path does not exist: ${targetPath}`);
   }

   const artJson = JSON.parse(fs.readFileSync(artJsonPath, 'utf8'));
   const activeState = getStateByHash(artJson.active.branch, artJson.active.parent) || {};

   const stats = fs.statSync(fullPath);
   const relativeTarget = path.relative(root, fullPath);

   if (!stats.isDirectory() && shouldIgnore(relativeTarget) && !activeState[relativeTarget]) {
     return `${relativeTarget} is being ignored. Edit your .artignore file to remove it.`;
   }

   let stage = { changes: {} };
   if (fs.existsSync(stagePath)) {
     stage = JSON.parse(fs.readFileSync(stagePath, 'utf8'));
   }

   let filesToProcess = [];

   if (stats.isDirectory()) {
     filesToProcess = fs.readdirSync(fullPath, { recursive: true })
       .filter(f => {
         const absoluteF = path.join(fullPath, f);
         const relF = path.relative(root, absoluteF);
         const isDir = fs.statSync(absoluteF).isDirectory();

         if (relF.startsWith('.art') || relF.includes(`${path.sep}.art`)) return false;

         const isTracked = !!activeState[relF];
         const isIgnored = shouldIgnore(relF);

         return !isDir && (!isIgnored || isTracked);
       })
       .map(f => path.relative(root, path.join(fullPath, f)));
   } else {
     filesToProcess = [relativeTarget];
   }

   if (filesToProcess.length === 0) {
     return "No changes to add.";
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

  const artPath = path.join(process.cwd(), '.art');
  const stagePath = path.join(artPath, 'stage.json');
  const artJsonPath = path.join(artPath, 'art.json');

  if (!fs.existsSync(stagePath)) {
    throw new Error('Nothing to commit (stage is empty).');
  }

  const stage = JSON.parse(fs.readFileSync(stagePath, 'utf8'));
  const artJson = JSON.parse(fs.readFileSync(artJsonPath, 'utf8'));
  const branch = artJson.active.branch;
  const timestamp = Date.now();

  const hash = crypto
    .createHash('sha1')
    .update(JSON.stringify(stage.changes) + timestamp + message)
    .digest('hex');

  const commitObject = {
    hash,
    message,
    timestamp,
    parent: artJson.active.parent,
    changes: stage.changes
  };

  const branchHistoryDir = path.join(artPath, 'history', 'local', branch);
  const commitFilePath = path.join(branchHistoryDir, `${hash}.json`);
  const manifestPath = path.join(branchHistoryDir, 'manifest.json');

  fs.writeFileSync(commitFilePath, JSON.stringify(commitObject, null, 2));

  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

  manifest.commits.push(hash);
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

  artJson.active.parent = hash;
  fs.writeFileSync(artJsonPath, JSON.stringify(artJson, null, 2));
  fs.unlinkSync(stagePath);

  return `[${branch} ${hash.slice(0, 7)}] ${message}`;
}

module.exports = {
  __libraryVersion: '0.2.6',
  __libraryAPIName: 'Workflow',
  status,
  add,
  commit
};
