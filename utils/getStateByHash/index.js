/**
 * art - Modern version control.
 * Module: Utils (v0.3.2)
 */

const fs = require('fs');
const path = require('path');

/**
 * Helper to reconstruct file states at a specific commit hash.
 */

 module.exports = (branchName, targetHash) => {
   const artPath = path.join(process.cwd(), '.art');
   const rootPath = path.join(artPath, 'root/manifest.json');

   if (!fs.existsSync(rootPath)) return {};

   const rootMaster = JSON.parse(fs.readFileSync(rootPath, 'utf8'));
   const branchPath = path.join(artPath, 'history/local', branchName);
   const manifestPath = path.join(branchPath, 'manifest.json');

   if (!fs.existsSync(manifestPath)) return {};

   const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

   let state = {};

   for (const partName of rootMaster.parts) {
     const partPath = path.join(artPath, 'root', partName);
     const partData = JSON.parse(fs.readFileSync(partPath, 'utf8'));

     for (const file of partData.files) {
       state[file.path] = file.content;
     }
   }

   if (!targetHash) return state;

   for (const hash of manifest.commits) {
     const commitPath = path.join(branchPath, `${hash}.json`);

     if (!fs.existsSync(commitPath)) continue;

     const commitMaster = JSON.parse(fs.readFileSync(commitPath, 'utf8'));

     let fullChanges = {};

     if (commitMaster.parts && Array.isArray(commitMaster.parts)) {
       for (const partName of commitMaster.parts) {
         const partPath = path.join(branchPath, partName);
         if (fs.existsSync(partPath)) {
           const partData = JSON.parse(fs.readFileSync(partPath, 'utf8'));
           Object.assign(fullChanges, partData.changes);
         }
       }
     } else if (commitMaster.changes) {
       fullChanges = commitMaster.changes;
     }

     for (const [filePath, changeSet] of Object.entries(fullChanges)) {
       if (Array.isArray(changeSet)) {
         let currentContent = state[filePath] || '';

         for (const operation of changeSet) {
           if (operation.type === 'insert') {
             currentContent = `${currentContent.slice(0, operation.position)}${operation.content}${currentContent.slice(operation.position)}`;
           } else if (operation.type === 'delete') {
             currentContent = `${currentContent.slice(0, operation.position)}${currentContent.slice(operation.position + operation.length)}`;
           }
         }

         state[filePath] = currentContent;
       } else {
         if (changeSet.type === 'createFile') {
           state[filePath] = changeSet.content;
         } else if (changeSet.type === 'deleteFile') {
           delete state[filePath];
         }
       }
     }

     if (hash === targetHash) break;
   }

   return state;
 };
