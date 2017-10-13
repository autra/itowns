var webpack = require('webpack');
var path = require('path');

var definePlugin = new webpack.DefinePlugin({
    __DEBUG__: "false", // I don't see a use case to have this true in transpiled source. Might be revisited later.
});

module.exports = {
    output: {
        libraryTarget: 'commonjs2',
        umdNamedDefine: true,
    },
    plugins: [
        definePlugin,
        new webpack.optimize.UglifyJsPlugin({
            compress: true,
            mangle: false
        }),
    ],
    module: {
        rules: [
            // please consider modifying corresponding loaders in webpack.config.js too
            {
                test: /\.glsl$/,
                include: [
                    path.resolve(__dirname, 'src'),
                ],
                loader: 'raw-loader',
            },
            {
                test: /\.json$/,
                include: [
                    path.resolve(__dirname, 'utils'),
                ],
                loader: 'raw-loader',
            },
        ],
    },
};
