/**
 * dep - Simple version control
 * Module: Setup (v0.0.1)
 */

const fs = require('fs');
const path = require('path');

const pkg = require('../../package.json');
const DEP_HOST = pkg.depConfig.host || 'http://localhost:1337';

/**
 * Initializes the local .dep directory structure.
 * @param {string} directoryPath - The path where the repository should be initialized.
 * @returns {string} A message indicating the result of the operation.
 */

function init (directoryPath = process.cwd()) {
  const depDirectory = path.join(directoryPath, '.dep');

  const folders = [
    '',
    'data',
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

  const dataManifest = {
    files: []
  };

  for (const file of files) {
    const fullPath = path.join(directoryPath, file);
    if (fs.lstatSync(fullPath).isFile()) {
      dataManifest.files.push({
        path: file,
        content: fs.readFileSync(fullPath, 'utf8')
      });
    }
  }

  fs.writeFileSync(
    path.join(depDirectory, 'data/manifest.json'),
    JSON.stringify(dataManifest, null, 2)
  );

  const historyManifest = {
    commits: []
  };

  fs.writeFileSync(
    path.join(depDirectory, 'history/local/main/manifest.json'),
    JSON.stringify(historyManifest, null, 2)
  );

  const depFile = {
    active: {
      branch: 'main',
      parent: null
    },
    remote: '',
    configuration: {
      userName: ''
    }
  };

  fs.writeFileSync(
    path.join(depDirectory, 'dep.json'),
    JSON.stringify(depFile, null, 2)
  );

  return `Initialized empty dep repository in ${depDirectory}`;
}

/**
 * Clones a repository, populates "data", and replays "history".
 * @param {string} repoSlug - The "userName/repoName" slug.
 * @returns {Promise<string>}
 */

async function clone (repoSlug) {
  if (!repoSlug || !repoSlug.includes('/')) {
    throw new Error('A valid slug is required.');
  }

  const [userName, repoName] = repoSlug.split('/');
  const targetPath = path.join(process.cwd(), repoName);
  const depPath = path.join(targetPath, '.dep');

  if (fs.existsSync(targetPath)) {
    throw new Error(`Destination path "${targetPath}" already exists.`);
  }

  fs.mkdirSync(targetPath);
  init(targetPath);

  const dataRes = await fetch(`${DEP_HOST}/${userName}/${repoName}/data/manifest.json`);
  const dataManifest = await dataRes.json();

  if (dataManifest.files) {
    for (const file of dataManifest.files) {
      const internalDataPath = path.join(depPath, 'data', file.path);
      const workingPath = path.join(targetPath, file.path);

      fs.mkdirSync(path.dirname(internalDataPath), { recursive: true });
      fs.writeFileSync(internalDataPath, file.content);
      fs.writeFileSync(workingPath, file.content);
    }
  }

  const historyUrl = `${DEP_HOST}/${userName}/${repoName}/history/remote/main/manifest.json`;
  const historyRes = await fetch(historyUrl);
  const historyManifest = await historyRes.json();

  if (historyManifest.commits) {
    for (const commitHash of historyManifest.commits) {
      const commitRes = await fetch(`${DEP_HOST}/${userName}/${repoName}/history/remote/main/${commitHash}.json`);
      const commitDiff = await commitRes.json();

      for (const filePath of Object.keys(commitDiff.changes)) {
        const fullPath = path.join(targetPath, filePath);
        const changeSet = commitDiff.changes[filePath];

        if (Array.isArray(changeSet)) {
          let currentContent = fs.existsSync(fullPath)
            ? fs.readFileSync(fullPath, 'utf8')
            : '';

          for (const operation of changeSet) {
            if (operation.type === 'insert') {
              currentContent = `${currentContent.slice(0, operation.position)}${operation.content}${currentContent.slice(operation.position)}`;
            } else if (operation.type === 'delete') {
              currentContent = `${currentContent.slice(0, operation.position)}${currentContent.slice(operation.position + operation.length)}`;
            }
          }

          fs.writeFileSync(fullPath, currentContent);
        } else if (changeSet.type === 'deleteFile') {
          if (fs.existsSync(fullPath)) {
            fs.unlinkSync(fullPath);
          }
        } else if (changeSet.type === 'createFile') {
          fs.writeFileSync(fullPath, changeSet.content || '');
        }
      }

      fs.writeFileSync(
        path.join(depPath, 'history/remote/main', `${commitHash}.json`),
        JSON.stringify(commitDiff, null, 2)
      );
    }
  }

  return `Successfully cloned and replayed ${repoSlug}.`;
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
