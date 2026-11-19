/* eslint-disable @typescript-eslint/no-var-requires */
/**
 * Web build of Session Desktop.
 *
 * Bundles the unmodified renderer (ts/) for the browser. Electron / Node / native dependencies are
 * swapped for browser implementations via `resolve.alias` and NormalModuleReplacementPlugin:
 *
 *   electron                 -> web/shims/electron.ts   (IPC emulated in-page + SQL worker)
 *   @signalapp/sqlcipher     -> web/shims/sqlcipher.ts  (SQLite WASM + OPFS)
 *   libsession_util_nodejs   -> web/libsession/*        (libsession WASM)
 *   fs / fs-extra            -> web/shims/fs.ts         (in-memory + IndexedDB)
 *   sharp, pino logger, ...  -> placeholders
 */
const path = require('path');
const webpack = require('webpack');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const CopyWebpackPlugin = require('copy-webpack-plugin');
const MiniCssExtractPlugin = require('mini-css-extract-plugin');
const sass = require('sass');
const { execSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const WEB = __dirname;
const packageJson = require('../package.json');

function gitCommit() {
  try {
    return execSync('git rev-parse --short HEAD', { cwd: ROOT }).toString().trim();
  } catch (e) {
    return 'unknown';
  }
}

const isProd = process.env.NODE_ENV === 'production';

/**
 * Upstream code (ts/) is compiled to CommonJS, like the desktop build does: the codebase relies on
 * CommonJS semantics for its (many) circular imports. Web-only code (web/) uses ES modules so that
 * webpack can see `new Worker(new URL(..., import.meta.url))`.
 */
const tsRules = [
  {
    test: /\.tsx?$/,
    include: path.join(ROOT, 'ts'),
    use: {
      loader: 'ts-loader',
      options: {
        transpileOnly: true,
        configFile: path.join(WEB, 'tsconfig.json'),
        compilerOptions: { module: 'commonjs', moduleResolution: 'node' },
      },
    },
  },
  {
    test: /\.tsx?$/,
    exclude: [/node_modules/, path.join(ROOT, 'ts')],
    use: {
      loader: 'ts-loader',
      options: { transpileOnly: true, configFile: path.join(WEB, 'tsconfig.json') },
    },
  },
];

const sharedAliases = {
  electron$: path.join(WEB, 'shims/electron.ts'),
  'electron/main$': path.join(WEB, 'shims/electron.ts'),
  '@signalapp/sqlcipher$': path.join(WEB, 'shims/sqlcipher.ts'),
  fs$: path.join(WEB, 'shims/fs.ts'),
  'fs-extra$': path.join(WEB, 'shims/fs.ts'),
  'fs/promises$': path.join(WEB, 'shims/fs.ts'),
  sharp$: path.join(WEB, 'shims/empty.ts'),
  'node-fetch$': path.join(WEB, 'shims/node-fetch.ts'),
  https$: path.join(WEB, 'shims/https.ts'),
  http$: path.join(WEB, 'shims/https.ts'),
  tls$: path.join(WEB, 'shims/https.ts'),
  net$: path.join(WEB, 'shims/https.ts'),
};

const fallbacks = {
  path: require.resolve('path-browserify'),
  os: require.resolve('os-browserify/browser'),
  stream: require.resolve('stream-browserify'),
  buffer: require.resolve('buffer/'),
  util: require.resolve('util/'),
  events: require.resolve('events/'),
  url: require.resolve('url/'),
  assert: require.resolve('assert/'),
  process: require.resolve('process/browser'),
  crypto: false,
  zlib: false,
  child_process: false,
  worker_threads: false,
  dns: false,
};

const definitions = {
  __SESSION_VERSION__: JSON.stringify(packageJson.version),
  __SESSION_COMMIT__: JSON.stringify(gitCommit()),
  __SESSION_WEB_RELAY_URL__: JSON.stringify(process.env.SESSION_WEB_RELAY_URL || ''),
  'process.env.NODE_ENV': JSON.stringify(isProd ? 'production' : 'development'),
};

/**
 * Some upstream files only make sense in Electron and are swapped wholesale for a web version.
 * The match is done on the absolute path of the resolved file.
 */
const fileReplacements = [
  [/ts[\\/]webworker[\\/]worker_interface\.ts$/, path.join(WEB, 'overrides/worker_interface.ts')],
  [/ts[\\/]util[\\/]logger[\\/]buildPinoLogger\.ts$/, path.join(WEB, 'shims/pino.ts')],
];

class ReplaceFilesPlugin {
  apply(compiler) {
    compiler.hooks.normalModuleFactory.tap('ReplaceFilesPlugin', nmf => {
      nmf.hooks.afterResolve.tap('ReplaceFilesPlugin', resolveData => {
        const data = resolveData.createData;
        if (!data || !data.resource) {
          return;
        }
        for (const [regex, replacement] of fileReplacements) {
          if (regex.test(data.resource)) {
            data.resource = replacement;
            data.context = path.dirname(replacement);
            data.userRequest = replacement;
            data.request = data.request.replace(/[^!]*$/, replacement);
            return;
          }
        }
      });
    });
  }
}

module.exports = {
  mode: isProd ? 'production' : 'development',
  devtool: isProd ? false : 'eval-cheap-module-source-map',
  context: ROOT,
  entry: { main: path.join(WEB, 'index.ts') },
  target: 'web',
  output: {
    path: path.join(ROOT, 'dist-web'),
    filename: '[name].[contenthash:8].js',
    chunkFilename: '[name].[contenthash:8].js',
    publicPath: 'auto',
    clean: true,
  },
  resolve: {
    extensions: ['.ts', '.tsx', '.js', '.json', '.svg'],
    alias: sharedAliases,
    fallback: fallbacks,
  },
  module: {
    rules: [
      ...tsRules,
      {
        test: /\.svg$/,
        include: path.join(ROOT, 'ts', 'svgs'),
        use: [{ loader: '@svgr/webpack', options: { exportType: 'default' } }],
      },
      {
        test: /\.s[ac]ss$/i,
        use: [
          MiniCssExtractPlugin.loader,
          { loader: 'css-loader', options: { url: false } },
          { loader: 'sass-loader', options: { implementation: sass } },
        ],
      },
      {
        test: /\.wasm$/,
        type: 'asset/resource',
      },
      {
        // emscripten / sqlite glue code expects to be loaded as-is
        test: /\.m?js$/,
        resolve: { fullySpecified: false },
      },
    ],
  },
  plugins: [
    new ReplaceFilesPlugin(),
    new webpack.NormalModuleReplacementPlugin(/^libsession_util_nodejs$/, resource => {
      const issuer = resource.contextInfo?.issuer || '';
      const isLibsessionWorker =
        /webworker[\\/]workers[\\/]node[\\/]libsession/.test(issuer) ||
        /web[\\/]libsession[\\/]/.test(issuer);
      // eslint-disable-next-line no-param-reassign
      resource.request = isLibsessionWorker
        ? path.join(WEB, 'libsession/index.ts')
        : path.join(WEB, 'libsession/renderer.ts');
    }),
    new webpack.ProvidePlugin({
      process: [path.join(WEB, 'shims/process.ts'), 'default'],
      Buffer: ['buffer', 'Buffer'],
    }),
    new webpack.DefinePlugin(definitions),
    // keep the css two folders deep, like stylesheets/dist/manifest.css on desktop, so its relative urls work
    new MiniCssExtractPlugin({ filename: 'stylesheets/dist/[name].[contenthash:8].css' }),
    new HtmlWebpackPlugin({
      template: path.join(WEB, 'index.html'),
      inject: 'body',
      scriptLoading: 'defer',
    }),
    new CopyWebpackPlugin({
      patterns: [
        { from: 'fonts', to: 'fonts' },
        { from: 'images', to: 'images' },
        { from: 'sound', to: 'sound' },
        { from: 'stylesheets/fonts.css', to: 'stylesheets/fonts.css' },
        {
          from: 'dynamic_assets',
          to: 'dynamic_assets',
          globOptions: { ignore: ['**/*.ts', '**/.git*', '**/node_modules/**'] },
        },
        { from: path.join(WEB, 'static'), to: '.', noErrorOnMissing: true },
      ],
    }),
  ],
  ignoreWarnings: [
    // ts-loader in transpileOnly mode can't tell type-only re-exports apart
    /export '.*' \(reexported as '.*'\) was not found/,
    /export '.*' was not found in/,
    /Critical dependency: the request of a dependency is an expression/,
  ],
  performance: { hints: false },
  node: { global: true, __dirname: 'mock', __filename: 'mock' },
  devServer: {
    static: { directory: path.join(ROOT, 'dist-web') },
    port: 8080,
    hot: false,
  },
};
