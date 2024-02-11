/*jshint node:true*/

module.exports = function (grunt) {
  'use strict';

  require('load-grunt-tasks')(grunt);
  const packageJSON = grunt.file.readJSON('package.json');

  grunt.initConfig({
    webfont: {
      seagull: {
        src: 'obj/glyphs/*.svg',
        dest: 'obj/raw',
        options: {
          font: 'Seagull Flags',
          engine: 'fontforge',
          types: 'ttf',
          autoHint: false,
          fontHeight: 2048,
          descent: 409,
          execMaxBuffer: 1024 * 1024,
          version: packageJSON.version,
          codepointsFile: 'obj/codepoints.json',
        },
      },
    },
  });

  grunt.loadNpmTasks('grunt-webfonts');
  grunt.registerTask('default', ['webfont']);
};
