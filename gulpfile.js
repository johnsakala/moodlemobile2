var gulp = require('gulp');
var gutil = require('gulp-util');
var bower = require('bower');
var concat = require('gulp-concat');
var insert = require('gulp-insert');
var stripComments = require('gulp-strip-comments');
var removeEmptyLines = require('gulp-remove-empty-lines');
var clipEmptyFiles = require('gulp-clip-empty-files');
var sass = require('gulp-sass');
var minifyCss = require('gulp-minify-css');
var rename = require('gulp-rename');
var tap = require('gulp-tap');
var sh = require('shelljs');
var fs = require('fs');
var through = require('through');
var path = require('path');
var File = gutil.File;

var license = '' +
  '// (C) Copyright 2015 Martin Dougiamas\n' +
  '//\n' +
  '// Licensed under the Apache License, Version 2.0 (the "License");\n' +
  '// you may not use this file except in compliance with the License.\n' +
  '// You may obtain a copy of the License at\n' +
  '//\n' +
  '//     http://www.apache.org/licenses/LICENSE-2.0\n' +
  '//\n' +
  '// Unless required by applicable law or agreed to in writing, software\n' +
  '// distributed under the License is distributed on an "AS IS" BASIS,\n' +
  '// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.\n' +
  '// See the License for the specific language governing permissions and\n' +
  '// limitations under the License.\n\n';

var paths = {
  js: [
    './www/app.js',
    './www/core/main.js',
    './www/core/lib/*.js',
    './www/core/filters/*.js',
    './www/core/directives/*.js',
    './www/core/components/**/main.js',
    './www/core/components/**/*.js',
    './www/addons/**/main.js',
    './www/addons/**/*.js',
    '!./www/**/tests/*.js'
  ],
  sass: ['./scss/**/*.scss'],
  lang: [
      './www/core/lang/',
      './www/core/components/**/lang/',
      './www/addons/**/lang/'
    ]
};

gulp.task('default', ['build', 'sass', 'lang']);

gulp.task('sass', function(done) {
  gulp.src('./scss/ionic.app.scss')
    .pipe(sass())
    .pipe(gulp.dest('./www/css/'))
    .pipe(minifyCss({
      keepSpecialComments: 0
    }))
    .pipe(rename({ extname: '.min.css' }))
    .pipe(gulp.dest('./www/css/'))
    .on('end', done);
});

gulp.task('watch', function() {
  gulp.watch(paths.sass, ['sass']);
  gulp.watch(paths.js, ['build']);
  gulp.watch(paths.lang, ['lang']);
});

gulp.task('build', function() {
  var dependencies = ["'mm.core'"],
      componentRegex = /core\/components\/([^\/]+)\/main.js/,
      pluginRegex = /addons\/([^\/]+)\/main.js/;

  gulp.src(paths.js)
    .pipe(clipEmptyFiles())
    .pipe(tap(function(file, t) {
      if (componentRegex.test(file.path)) {
        dependencies.push("'mm.core." + file.path.match(componentRegex)[1] + "'");
      } else if (pluginRegex.test(file.path)) {
        dependencies.push("'mm.addons." + file.path.match(pluginRegex)[1] + "'");
      }
    }))

    // Remove comments, remove empty lines, concat and add license.
    .pipe(stripComments())
    .pipe(removeEmptyLines())
    .pipe(concat('mm.bundle.js'))
    .pipe(insert.prepend(license))

    // Add dependencies, this assumes that the mm module is declared on one line.
    .pipe(insert.transform(function(contents) {
      return contents.replace(
        "angular.module('mm', ['ionic'",
        "angular.module('mm', ['ionic', " + dependencies.join(', '));
    }))
    .pipe(gulp.dest('./www/build'));
});

gulp.task('lang', function() {

  /**
   * Get the names of the JSON files inside a directory.
   * @param  {String} dir Directory's path.
   * @return {Array}      List of filenames.
   */
  function getFilenames(dir) {
    return fs.readdirSync(dir)
      .filter(function(file) {
        return file.indexOf('.json') > -1;
      })
  }

  /**
   * Copy a property from one object to another, adding a prefix to the key if needed.
   * @param {Object} target Object to copy the properties to.
   * @param {Object} source Object to copy the properties from.
   * @param {String} prefix Prefix to add to the keys.
   */
  function addProperties(target, source, prefix) {
    for (var property in source) {
      target[prefix + property] = source[property];
    }
  }

  /**
   * Treats the merged JSON data, adding prefixes depending on the component.
   * @param  {Object} data Merged data.
   * @return {Buffer}      Buffer with the treated data.
   */
  function treatMergedData(data) {
    var merged = {};

    for (var filepath in data) {

      if (filepath.indexOf('core/lang') == 0) {

        addProperties(merged, data[filepath], '');

      } else if (filepath.indexOf('core/components') == 0) {

        var componentName = filepath.replace('core/components/', '');
        componentName = componentName.substr(0, componentName.indexOf('/'));
        addProperties(merged, data[filepath], 'mm.core.'+componentName+'.');

      } else if (filepath.indexOf('addons') == 0) {

        var pluginName = filepath.replace('addons/', '');
        pluginName = pluginName.substr(0, pluginName.indexOf('/'));
        addProperties(merged, data[filepath], 'mma.'+pluginName+'.');

      }

    }

    return new Buffer(JSON.stringify(merged));
  }

  /**
   * Treats a file to merge JSONs. This function is based on gulp-jsoncombine module.
   * https://github.com/reflog/gulp-jsoncombine
   * @param  {Object} file File treated.
   */
  function treatFile(file, data) {
    if (file.isNull() || file.isStream()) {
      return; // ignore
    }
    try {
      var path = file.path.substr(file.path.indexOf('/www/') + 5, file.path.length-5);
      data[path] = JSON.parse(file.contents.toString());
    } catch (err) {
      console.log('Error parsing JSON: ' + err);
    }
  }

  // Get filenames to know which languages are available.
  var filenames = getFilenames(paths.lang[0]);

  filenames.forEach(function(filename, index) {

    var language = filename.replace('.json', '');

    var langpaths = paths.lang.map(function(path) {
      if (path.slice(-1) != '/') {
        path = path + '/';
      }
      return path + language + '.json';
    });

    var data = {};
    var firstFile = null;

    gulp.src(langpaths)
      .pipe(clipEmptyFiles())
      .pipe(through(function(file) {
        if (!firstFile) {
          firstFile = file;
        }
        return treatFile(file, data);
      }, function() {
        /* This implementation is based on gulp-jsoncombine module.
         * https://github.com/reflog/gulp-jsoncombine */
        if (firstFile) {
          var joinedPath = path.join(firstFile.base, language+'.json');

          var joinedFile = new File({
            cwd: firstFile.cwd,
            base: firstFile.base,
            path: joinedPath,
            contents: treatMergedData(data)
          });

          this.emit('data', joinedFile);
        }
        this.emit('end');
      }))
      .pipe(gulp.dest('./www/build/lang'));

  });
});

gulp.task('install', ['git-check'], function() {
  return bower.commands.install()
    .on('log', function(data) {
      gutil.log('bower', gutil.colors.cyan(data.id), data.message);
    });
});

gulp.task('git-check', function(done) {
  if (!sh.which('git')) {
    console.log(
      '  ' + gutil.colors.red('Git is not installed.'),
      '\n  Git, the version control system, is required to download Ionic.',
      '\n  Download git here:', gutil.colors.cyan('http://git-scm.com/downloads') + '.',
      '\n  Once git is installed, run \'' + gutil.colors.cyan('gulp install') + '\' again.'
    );
    process.exit(1);
  }
  done();
});
