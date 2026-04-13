var fs = require('fs');
var idx = JSON.parse(fs.readFileSync('public/EPI/epi-index.json', 'utf-8'));

var items = [];
for (var i = 0; i < idx.length; i++) {
  var e = idx[i];
  var title = e.title.replace(/[\r\n]/g, ' ').trim();
  var slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').substring(0, 80);
  items.push({ slug: slug, title: title, file: 'EPI/LEPs/' + slug + '.md' });
}
items.sort(function(a, b) { return a.title.localeCompare(b.title); });

var inst = JSON.parse(fs.readFileSync('public/instruments.json', 'utf-8'));
inst.nsw.categories.lep.items = items;
fs.writeFileSync('public/instruments.json', JSON.stringify(inst, null, 2) + '\n', 'utf-8');
console.log('Updated instruments.json with', items.length, 'LEPs');
