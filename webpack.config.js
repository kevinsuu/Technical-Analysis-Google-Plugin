const path = require('path');
const CopyPlugin = require('copy-webpack-plugin');
const MiniCssExtractPlugin = require('mini-css-extract-plugin');

module.exports = {
  entry: {
    'background/service-worker': './src/background/service-worker.js',
    'content/injector': './src/content/injector.js',
    'content/recorder': './src/content/recorder.js',
    'content/executor': './src/content/executor.js',
    'options/options': './src/options/options.js',
    'ui/panel': './src/ui/panel.js',
  },
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: '[name].js',
    clean: true,
  },
  module: {
    rules: [
      {
        test: /\.css$/,
        use: [MiniCssExtractPlugin.loader, 'css-loader'],
      },
    ],
  },
  plugins: [
    new MiniCssExtractPlugin({
      filename: '[name].css',
    }),
    new CopyPlugin({
      patterns: [
        { from: 'manifest.json', to: 'manifest.json' },
        { from: 'src/ui/panel.html', to: 'ui/panel.html' },
        { from: 'src/options/options.html', to: 'options/options.html' },
        { from: 'assets', to: 'assets' },
      ],
    }),
  ],
  resolve: {
    extensions: ['.js'],
  },
  devtool: 'cheap-module-source-map',
};
