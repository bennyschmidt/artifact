/**
 * Artifact - Modern version control.
 * @author Benny Schmidt (https://github.com/bennyschmidt)
 * @project https://github.com/bennyschmidt/artifact
 * Module: Setup (v0.3.5)
 */

const fs = require('fs');
const path = require('path');

const pkg = require('../package.json');
const shouldIgnore = require('../utils/shouldIgnore');
const { MAX_PART_SIZE } = require('../utils/constants');

const ARTIFACT_HOST = pkg.artConfig.host || 'http://localhost:1337';

/**
 * Internal helper to create the .art directory tree.
 * @param {string} artDirectory - The path to the .art folder.
 */

function ensureDirStructure (artDirectory) {
  /**
   * Define the core folder hierarchy required for local and remote tracking.
   */

  const folders = [
    '',
    'root',
    'history',
    'history/local',
    'history/local/main',
    'history/remote',
    'history/remote/main'
  ];

  for (const folder of folders) {
    const fullPath = path.join(artDirectory, folder);

    if (!fs.existsSync(fullPath)) {
      fs.mkdirSync(fullPath, { recursive: true });
    }
  }
}

/**
 * Initializes the local .art directory structure and indexes current files.
 * @param {string} directoryPath - The root directory to initialize.
 * @returns {string} Success message.
 */

function init (directoryPath = process.cwd()) {
  /**
   * Check for an existing repository to prevent accidental overwrites.
   */

  const artDirectory = path.join(directoryPath, '.art');

  if (fs.existsSync(artDirectory)) {
    return `Reinitialized existing art repository in ${artDirectory}.`;
  }

  ensureDirStructure(artDirectory);

  /**
   * Filter the working directory to find unignored files that are not internal.
   */

  const files = fs.readdirSync(directoryPath, { recursive: true })
    .filter(file => {
      const isInternal = file === '.art' || file.startsWith('.art' + path.sep);

      return !isInternal && !shouldIgnore(file);
    });

  const rootMasterManifest = { parts: [] };

  let currentPartFiles = [];
  let currentPartChars = 0;

  /**
   * Internal helper to save indexed file snapshots into manifest parts.
   */

  const saveManifestPart = () => {
    if (currentPartFiles.length === 0) {
      return;
    }

    const partIndex = rootMasterManifest.parts.length;
    const partName = `manifest.part.${partIndex}.json`;
    const partPath = path.join(artDirectory, 'root', partName);

    fs.writeFileSync(
      partPath,
      JSON.stringify({ files: currentPartFiles }, null, 2)
    );

    rootMasterManifest.parts.push(partName);
    currentPartFiles = [];
    currentPartChars = 0;
  };

  /**
   * Iterate through files and group their content into the root manifest.
   */

  for (const file of files) {
    const fullPath = path.join(directoryPath, file);

    if (fs.lstatSync(fullPath).isFile()) {
      const content = fs.readFileSync(fullPath, 'utf8');

      if (currentPartChars + content.length > MAX_PART_SIZE && currentPartFiles.length > 0) {
        saveManifestPart();
      }

      currentPartFiles.push({
        path: file,
        content: content
      });

      currentPartChars += content.length;
    }
  }

  saveManifestPart();

  /**
   * Initialize manifest files for root and default branch histories.
   */

  fs.writeFileSync(
    path.join(artDirectory, 'root/manifest.json'),
    JSON.stringify(rootMasterManifest, null, 2)
  );

  fs.writeFileSync(
    path.join(artDirectory, 'history/local/main/manifest.json'),
    JSON.stringify({ commits: [] }, null, 2)
  );

  fs.writeFileSync(
    path.join(artDirectory, 'history/remote/main/manifest.json'),
    JSON.stringify({ commits: [] }, null, 2)
  );

  /**
   * Create the primary art.json state file with default pointers.
   */

  const artFile = {
    active: { branch: 'main', parent: null },
    remote: '',
    configuration: { handle: '', personalAccessToken: '' }
  };

  fs.writeFileSync(
    path.join(artDirectory, 'art.json'),
    JSON.stringify(artFile, null, 2)
  );

  return `Initialized empty art repository in ${artDirectory}.`;
}

/**
 * Clone a repository and replay history.
 * @param {string} repoSlug - The handle/repo identifier.
 * @param {string} providedToken - Optional access token.
 * @returns {Promise<string>} Success message.
 */

async function clone (repoSlug, providedToken = null) {
  /**
   * Validate slug format and check destination availability.
   */

  if (!repoSlug || !repoSlug.includes('/')) {
    throw new Error('A valid slug is required (handle/repo).');
  }

  const [handle, repo] = repoSlug.split('/');
  const targetPath = path.join(process.cwd(), repo);
  const originalCwd = process.cwd();

  if (fs.existsSync(targetPath)) {
    throw new Error(`Destination path "${targetPath}" already exists.`);
  }

  /**
   * Prepare target directory and enter the workspace.
   */

  fs.mkdirSync(targetPath, { recursive: true });

  const artPath = path.join(targetPath, '.art');

  ensureDirStructure(artPath);
  process.chdir(targetPath);

  try {
    /**
     * Set up local art.json with remote tracking info.
     */

    const artJsonPath = path.join(artPath, 'art.json');

    const artJson = {
      active: { branch: 'main', parent: null },
      remote: `${ARTIFACT_HOST}/${handle}/${repo}`,
      configuration: {
        handle: '',
        personalAccessToken: providedToken || ''
      }
    };

    fs.writeFileSync(artJsonPath, JSON.stringify(artJson, null, 2));

    const token = artJson.configuration.personalAccessToken;

    /**
     * Fetch the root manifest to reconstruct the project's base state.
     */

    const rootRes = await fetch(
      `${ARTIFACT_HOST}/manifest`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'root',
          handle,
          repo,
          branch: 'main',

          ...(token && { personalAccessToken: token })
        })
      }
    );

    const masterManifest = await rootRes.json();

    fs.writeFileSync(
      path.join(artPath, 'root/manifest.json'),
      JSON.stringify(masterManifest, null, 2)
    );

    /**
     * Download root parts and write files to the working directory.
     */

    for (const partName of masterManifest.parts) {
      const partRes = await fetch(
        `${ARTIFACT_HOST}/part`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            handle,
            repo,
            partName,
            ...(token && { personalAccessToken: token })
          })
        }
      );

      const partData = await partRes.json();

      fs.writeFileSync(
        path.join(artPath, 'root', partName),
        JSON.stringify(partData, null, 2)
      );

      for (const file of partData.files) {
        const workingPath = path.join(targetPath, file.path);

        fs.mkdirSync(path.dirname(workingPath), { recursive: true });
        fs.writeFileSync(workingPath, file.content);
      }
    }

    /**
     * Retrieve the full history manifest for the main branch.
     */

    const historyRes = await fetch(
      `${ARTIFACT_HOST}/manifest`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'history',
          handle,
          repo,
          branch: 'main',
          ...(token && { personalAccessToken: token })
        })
      }
    );

    const historyManifest = await historyRes.json();
    const localHistoryDir = path.join(artPath, 'history/local/main');
    const remoteHistoryDir = path.join(artPath, 'history/remote/main');

    /**
     * Replay every commit in chronological order to sync local state with
     * remote history.
     */

    for (const commitHash of historyManifest.commits) {
      const commitRes = await fetch(
        `${ARTIFACT_HOST}/commit`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            handle,
            repo,
            branch: 'main',
            hash: commitHash,
            ...(token && { personalAccessToken: token })
          })
        }
      );

      const commitMaster = await commitRes.json();

      let fullChanges = {};

      /**
       * Fetch and merge paginated changes if the commit is split into parts.
       */

      if (commitMaster.parts && commitMaster.parts.length > 0) {
        for (const partName of commitMaster.parts) {
          const partRes = await fetch(
            `${ARTIFACT_HOST}/part`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                type: 'history',
                handle,
                repo,
                branch: 'main',
                partName,

                ...(token && { personalAccessToken: token })
              })
            }
          );

          const partData = await partRes.json();

          fs.writeFileSync(path.join(localHistoryDir, partName), JSON.stringify(partData, null, 2));
          fs.writeFileSync(path.join(remoteHistoryDir, partName), JSON.stringify(partData, null, 2));

          Object.assign(fullChanges, partData.changes);
        }
      } else if (commitMaster.changes) {
        fullChanges = commitMaster.changes;
      }

      const masterContent = JSON.stringify(commitMaster, null, 2);

      fs.writeFileSync(path.join(localHistoryDir, `${commitHash}.json`), masterContent);
      fs.writeFileSync(path.join(remoteHistoryDir, `${commitHash}.json`), masterContent);

      /**
       * Apply individual file operations (insert, delete, create) to the working tree.
       */

      for (const [filePath, changeSet] of Object.entries(fullChanges)) {
        const fullPath = path.join(targetPath, filePath);

        if (Array.isArray(changeSet)) {
          let content = fs.existsSync(fullPath) ? fs.readFileSync(fullPath, 'utf8') : '';

          for (const operation of changeSet) {
            if (operation.type === 'insert') {
              content = content.slice(0, operation.position) + operation.content + content.slice(operation.position);
            } else if (operation.type === 'delete') {
              content = content.slice(0, operation.position) + content.slice(operation.position + operation.length);
            }
          }

          fs.writeFileSync(fullPath, content);
        } else if (changeSet.type === 'createFile') {
          fs.mkdirSync(path.dirname(fullPath), { recursive: true });
          fs.writeFileSync(fullPath, changeSet.content || '');
        } else if (changeSet.type === 'deleteFile' && fs.existsSync(fullPath)) {
          fs.unlinkSync(fullPath);
        }
      }
    }

    /**
     * Finalize the manifests and set the active parent pointer to the latest commit.
     */

    const manifestJson = JSON.stringify({ commits: historyManifest.commits }, null, 2);

    fs.writeFileSync(path.join(localHistoryDir, 'manifest.json'), manifestJson);
    fs.writeFileSync(path.join(remoteHistoryDir, 'manifest.json'), manifestJson);

    if (historyManifest.commits.length > 0) {
      artJson.active.parent = historyManifest.commits[historyManifest.commits.length - 1];
      fs.writeFileSync(artJsonPath, JSON.stringify(artJson, null, 2));
    }

    return `Successfully cloned and replayed ${repoSlug}.`;
  } catch (error) {
    throw error;
  } finally {
    process.chdir(originalCwd);
  }
}

/**
 * Updates the configuration in art.json.
 * @param {string} key - Configuration key.
 * @param {any} value - Configuration value.
 * @returns {Object} Updated configuration object.
 */

function config (key, value) {
  /**
   * Verify repo existence and update specific configuration fields.
   */

  const manifestPath = path.join(process.cwd(), '.art', 'art.json');

  if (!fs.existsSync(manifestPath)) {
    throw new Error('No art repository found.');
  }

  const manifest = JSON.parse(
    fs.readFileSync(manifestPath, 'utf8')
  );

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
  config,
  ensureDirStructure
};
