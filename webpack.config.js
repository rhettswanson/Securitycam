const HtmlWebpackPlugin = require('html-webpack-plugin');
const CopyPlugin = require('copy-webpack-plugin');
const path = require('path');
module.exports = {
  mode: 'production',
  entry: "./src/index.js",
  output: {
    path: path.resolve(__dirname, "./dist"),
    filename: "index_bundle.js",
  },
  plugins: [
    new HtmlWebpackPlugin({
      template: path.resolve(__dirname, "./src/index.html"),
    }),
    new CopyPlugin({
      patterns: [
        { from: "static", to: "static" },
      ],
    }),
  ],
  devServer: {
    static: [path.resolve(__dirname, "static")],
  },
  performance: {
    hints: false, // Suppresses all performance warnings about asset/entrypoint sizes
  },
};