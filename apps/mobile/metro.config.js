const path = require('path');
const { getDefaultConfig } = require('@react-native/metro-config');

const config = getDefaultConfig(__dirname);

const root = path.resolve(__dirname, '../..');

config.watchFolders = [root];
config.resolver.nodeModulesPaths = [
  path.resolve(root, 'node_modules'),
  path.resolve(__dirname, 'node_modules'),
];
config.resolver.sourceExts = ['ts', 'tsx', 'js', 'jsx', 'json'];
config.resolver.unstable_enablePackageExports = true;

module.exports = config;
