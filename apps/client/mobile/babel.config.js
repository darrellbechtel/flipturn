module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    plugins: [
      // Reanimated 4 moved its Babel plugin to react-native-worklets.
      // This must be the last plugin in the list.
      'react-native-worklets/plugin',
    ],
  };
};
