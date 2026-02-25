/**
 * art - Modern version control.
 * Core Library Entry Point (v0.3.4)
 */

const Setup = require('./setup');
const Workflow = require('./workflow');
const Branching = require('./branching');
const Contributions = require('./contributions');
const Changes = require('./changes');
const Caches = require('./caches');

const art = {

  // Setup

  init: Setup.init,
  clone: Setup.clone,
  config: Setup.config,

  // Workflow

  status: Workflow.status,
  add: Workflow.add,
  commit: Workflow.commit,

  // Branching

  branch: Branching.branch,
  checkout: Branching.checkout,
  merge: Branching.merge,

  // Contributions

  remote: Contributions.remote,
  fetch: Contributions.fetch,
  pull: Contributions.pull,
  push: Contributions.push,

  // Changes

  log: Changes.log,
  diff: Changes.diff,

  // Caches

  stash: Caches.stash,
  reset: Caches.reset,
  rm: Caches.rm,

  // Metadata

  version: '0.3.4',
  modules: [
    Setup.__libraryAPIName,
    Workflow.__libraryAPIName,
    Branching.__libraryAPIName,
    Contributions.__libraryAPIName,
    Changes.__libraryAPIName,
    Caches.__libraryAPIName
  ]
};

module.exports = art;
