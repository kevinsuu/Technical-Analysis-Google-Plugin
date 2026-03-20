const path = require('path');
const { execSync } = require('child_process');
const CopyPlugin = require('copy-webpack-plugin');
const MiniCssExtractPlugin = require('mini-css-extract-plugin');

function getAutoVersion() {
  const pkg = require('./package.json');
  const [major, minor] = pkg.version.split('.');
  try {
    const commitCount = execSync('git rev-list --count HEAD', { encoding: 'utf-8' }).trim();
    return `${major}.${minor}.${commitCount}`;
  } catch {
    return pkg.version;
  }
}

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
        {
          from: 'manifest.json',
          to: 'manifest.json',
          transform(content) {
            const manifest = JSON.parse(content.toString());
            manifest.version = getAutoVersion();
            return JSON.stringify(manifest, null, 2);
          },
        },
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
