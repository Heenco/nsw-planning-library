var fs = require('fs');
var path = require('path');
var idx = JSON.parse(fs.readFileSync('public/EPI/epi-index.json', 'utf-8'));
var dir = 'public/EPI/LEPs';
var renamed = 0;

for (var i = 0; i < idx.length; i++) {
  var entry = idx[i];
  var oldFile = path.join(dir, entry.code + '.md');
  if (!fs.existsSync(oldFile)) continue;

  var slug = entry.title
    .replace(/[\r\n]/g, ' ')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .substring(0, 80);
  var newFile = path.join(dir, slug + '.md');

  if (fs.existsSync(newFile)) {
    console.log('SKIP (exists):', slug);
    continue;
  }

  fs.renameSync(oldFile, newFile);
  renamed++;
}
console.log('Renamed:', renamed, 'of', idx.length);
