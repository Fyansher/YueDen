/* Public scanner entry: the selected type is only an output filter. */
module.exports={scan:(roots,type,options={})=>type==='game'&&!options.explicitFiles?require('./scan-folder-games').scan(roots,type,options):require('./scan-pipeline').scan(roots,type,options)};
