module.exports = {
  presets: ['module:@react-native/babel-preset'],
  // WatermelonDB 0.28 no longer ships its `@nozbe/watermelondb/babel`
  // plugin (it was dropped from the published package), so we enable the
  // legacy decorators transform it used to provide directly. The RN preset
  // already adds class-properties with `loose: true`, which is the exact
  // combination the WatermelonDB decorators (@field, @children, ...) need.
  plugins: [['@babel/plugin-proposal-decorators', { legacy: true }]],
};
