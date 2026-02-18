/**
 * dep - Modern version control.
 * Module: Setup (v0.1.6)
 */

const fs = require('fs');
const path = require('path');

const pkg = require('../package.json');
const { remote } = require('../contributions');

const DEP_HOST = pkg.depConfig.host || 'http://localhost:1337';

/**
 * Initializes the local .dep directory structure.
 */

function init (directoryPath = process.cwd()) {
  const depDirectory = path.join(directoryPath, '.dep');

  const folders = [
    '',
    'root',
    'history',
    'history/local',
    'history/local/main',
    'history/remote',
    'history/remote/main'
  ];

  if (fs.existsSync(depDirectory)) {
    return `Reinitialized existing dep repository in ${depDirectory}`;
  }

  for (const folder of folders) {
    const fullPath = path.join(depDirectory, folder);

    if (!fs.existsSync(fullPath)) {
      fs.mkdirSync(fullPath, { recursive: true });
    }
  }

  const files = fs.readdirSync(directoryPath).filter(f => f !== '.dep');
  const rootManifest = { files: [] };

  for (const file of files) {
    const fullPath = path.join(directoryPath, file);

    if (fs.lstatSync(fullPath).isFile()) {
      rootManifest.files.push({
        path: file,
        content: fs.readFileSync(fullPath, 'utf8')
      });
    }
  }

  fs.writeFileSync(
    path.join(depDirectory, 'root/manifest.json'),
    JSON.stringify(rootManifest, null, 2)
  );

  fs.writeFileSync(
    path.join(depDirectory, 'history/local/main/manifest.json'),
    JSON.stringify({ commits: [] }, null, 2)
  );

  fs.writeFileSync(
    path.join(depDirectory, 'history/remote/main/manifest.json'),
    JSON.stringify({ commits: [] }, null, 2)
  );

  const depFile = {
    active: { branch: 'main', parent: null },
    remote: '',
    configuration: { handle: '', personalAccessToken: '' }
  };

  fs.writeFileSync(
    path.join(depDirectory, 'dep.json'),
    JSON.stringify(depFile, null, 2)
  );

  return `Initialized empty dep repository in ${depDirectory}`;
}

/**
 * Clones a repository by fetching manifests and commits via POST.
 */

 /**
  * Clones a repository by fetching manifests and commits via POST.
  * @param {string} repoSlug - The handle/repo identifier.
  * @param {string} providedToken - Optional token for authentication.
  */

 async function clone(repoSlug, providedToken = null) {
   if (!repoSlug || !repoSlug.includes('/')) {
     throw new Error('A valid slug is required (e.g., handle/repo).');
   }

   const [handle, repo] = repoSlug.split('/');
   const targetPath = path.join(process.cwd(), repo);
   const originalCwd = process.cwd();

   if (fs.existsSync(targetPath)) {
     throw new Error(`Destination path "${targetPath}" already exists.`);
   }

   fs.mkdirSync(targetPath, { recursive: true });
   init(targetPath);
   process.chdir(targetPath);

   try {
     const depPath = path.join(targetPath, '.dep');
     const depJsonPath = path.join(depPath, 'dep.json');

     if (providedToken) {
       const depJson = JSON.parse(fs.readFileSync(depJsonPath, 'utf8'));

       depJson.configuration.personalAccessToken = providedToken;
       fs.writeFileSync(depJsonPath, JSON.stringify(depJson, null, 2));

       remote(`${handle}/${repo}`);
     }

     const depJson = JSON.parse(fs.readFileSync(depJsonPath, 'utf8'));
     const token = depJson.configuration.personalAccessToken;

     const rootRes = await fetch(`${DEP_HOST}/manifest`, {
       method: 'POST',
       headers: { 'Content-Type': 'application/json' },
       body: JSON.stringify({
         type: 'root',
         handle,
         repo,
         branch: 'main',

         ...(token && { personalAccessToken: token })
       })
     });

     if (rootRes.status === 401 || rootRes.status === 403) {
       throw new Error('Authentication failed. Access token required.');
     }

     const rootManifest = await rootRes.json();

     if (rootManifest.files) {
       for (const file of rootManifest.files) {
         const internalRootPath = path.join(depPath, 'root', file.path);
         const workingPath = path.join(targetPath, file.path);

         fs.mkdirSync(path.dirname(internalRootPath), { recursive: true });
         fs.writeFileSync(internalRootPath, file.content);
         fs.writeFileSync(workingPath, file.content);
       }
     }

     const historyRes = await fetch(`${DEP_HOST}/manifest`, {
       method: 'POST',
       headers: { 'Content-Type': 'application/json' },
       body: JSON.stringify({
         type: 'history',
         handle,
         repo,
         branch: 'main',

         ...(token && { personalAccessToken: token })
       })
     });

     const historyManifest = await historyRes.json();

     if (historyManifest.commits) {
       for (const commitHash of historyManifest.commits) {
         const commitRes = await fetch(`${DEP_HOST}/commit`, {
           method: 'POST',
           headers: { 'Content-Type': 'application/json' },
           body: JSON.stringify({
             handle,
             repo,
             branch: 'main',
             hash: commitHash,

             ...(token && { personalAccessToken: token })
           })
         });

         const commitDiff = await commitRes.json();

         for (const filePath of Object.keys(commitDiff.changes)) {
           const fullPath = path.join(targetPath, filePath);
           const changeSet = commitDiff.changes[filePath];

           if (Array.isArray(changeSet)) {
             let currentContent = fs.existsSync(fullPath) ? fs.readFileSync(fullPath, 'utf8') : '';

             for (const operation of changeSet) {
               if (operation.type === 'insert') {
                 currentContent = currentContent.slice(0, operation.position) + operation.content + currentContent.slice(operation.position);
               } else if (operation.type === 'delete') {
                 currentContent = currentContent.slice(0, operation.position) + currentContent.slice(operation.position + operation.length);
               }
             }

             fs.writeFileSync(fullPath, currentContent);
           } else if (changeSet.type === 'deleteFile') {
             if (fs.existsSync(fullPath)) {
               fs.unlinkSync(fullPath);
             }
           } else if (changeSet.type === 'createFile') {
             fs.mkdirSync(path.dirname(fullPath), { recursive: true });
             fs.writeFileSync(fullPath, changeSet.content || '');
           }
         }

         const remoteHistoryDir = path.join(depPath, 'history/remote/main');

         if (!fs.existsSync(remoteHistoryDir)) {
           fs.mkdirSync(remoteHistoryDir, { recursive: true });
         }

         fs.writeFileSync(
           path.join(remoteHistoryDir, `${commitHash}.json`),
           JSON.stringify(commitDiff, null, 2)
         );
       }
     }

     return `Successfully cloned and replayed ${repoSlug}.`;
   } catch (error) {
     throw error;
   } finally {
     process.chdir(originalCwd);
   }
 }

/**
 * Updates the configuration in dep.json.
 */

function config (key, value) {
  const manifestPath = path.join(process.cwd(), '.dep', 'dep.json');

  if (!fs.existsSync(manifestPath)) {
    throw new Error('No dep repository found.');
  }

  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

  if (key && value !== undefined) {
    manifest.configuration[key] = value;

    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  }

  return manifest.configuration;
}

module.exports = {
  __libraryVersion: pkg.version,
  __libraryAPIName: 'Setup',
  init,
  clone,
  config
};
