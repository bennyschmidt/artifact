/**
 * Artifact - Modern version control.
 * @author Benny Schmidt (https://github.com/bennyschmidt)
 * @project https://github.com/bennyschmidt/artifact
 * Module: Utility / shouldIgnore (v0.3.5)
 */

const fs = require('fs');
const path = require('path');

let memoizedRules = null;

/**
 * Parses .artignore and converts glob-like patterns into executable regex.
 * @returns {RegExp[]} An array of compiled regex rules.
 */

function getRules () {
  /**
   * Return cached rules if they have already been processed.
   */

  if (memoizedRules) {
    return memoizedRules;
  }

  const root = process.cwd();
  const ignorePath = path.join(root, '.artignore');
  const rules = [];

  /**
   * Read the ignore file and transform each line into a path-matching regex.
   */

  if (fs.existsSync(ignorePath)) {
    const lines = fs.readFileSync(ignorePath, 'utf8').split(/\r?\n/);

    for (let line of lines) {
      line = line.trim();

      if (!line || line.startsWith('#')) {
        continue;
      }

      /**
       * Escape special characters and translate wildcards (* and **)
       * into valid regex syntax.
       */

      let regexStr = line
        .replace(/[.+^${}()|[\]\\]/g, '\\$&')
        .replace(/\/\*\*\//g, '(/.+/|/)')
        .replace(/\*/g, '[^/]+')
        .replace(/\/$/, '(/.+)?');

      if (line.startsWith('/')) {
        regexStr = '^' + regexStr.slice(1);
      } else {
        regexStr = '(^|/)' + regexStr;
      }

      rules.push(new RegExp(regexStr));
    }
  }

  memoizedRules = rules;

  return rules;
}

/**
 * Determines if a given relative path should be excluded from version control.
 * @param {string} relativePath - The path to check.
 * @returns {boolean} True if the path matches an ignore rule.
 */

function shouldIgnore (relativePath) {
  /**
   * Normalize path separators to forward slashes and protect the internal .art folder.
   */

  const normalizedPath = relativePath.split(path.sep).join('/');

  if (normalizedPath === '.art' || normalizedPath.startsWith('.art/')) {
    return true;
  }

  /**
   * Test the path against the compiled list of ignore patterns.
   */

  const rules = getRules();

  return rules.some(rule => {
    return rule.test(normalizedPath);
  });
}

module.exports = shouldIgnore;
