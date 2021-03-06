#!/usr/bin/env node
/*
apk_pull CLI
Extract any APK from any connected Android device or Genymotion Player
Usage:
node apk_pull appname/appid [outputdirectory] 
*/

// init globals
var	_shell 		= 	require('shelljs'),
	_colors 	=	require('colors'),
	_ora 		= 	require('ora'),
	_path 		= 	require('path'),
	fs 			=	require('fs'),
	_cheerio 	=	require('cheerio'),
	_cur_dir 	= 	process.cwd(),
	args 		= 	process.argv.slice(2),
	connected 	= 	false,
	_packages 	= 	{},
	_packnames	= 	{},
	_progress;

var _omit_packages = [
	'com.monotype.*',
	'com.sec.*',
	'com.samsung.*',
	'org.simalliance.*',
	'com.android.*',
	'com.example.*',
	'jp.co.omronsoft.openwnn',
	'com.svox.pico',
	'com.amaze.filemanager',
	'com.google.android.*',
	'com.gd.mobicore.pa',
	'android',
	'com.fmm.*',
	'com.visionobjects.*',
	'com.wssnps',
	'com.policydm',
	'com.wssyncmldm',
	'daemon*'
];

//shell run
var _run = function(cmd) {
	var _r = _shell.exec(cmd, { silent:true });
	return { out: _r.stdout, code: _r.code, error: _r.stderr };
};

//get appname from appid
var getName = function(appid, cb) {
	var request = require('request'), _resp='', res, body='', $;
	//console.log('requesting name for '.green+appid.yellow);
	request({ timeout:3000, url:'https://play.google.com/store/apps/details?id='+appid.toLowerCase() }, function (error, response, body) {
	  if (!error && response.statusCode == 200) {
		_progress.color = 'cyan', _progress.text = 'reading package: '+this._appid;
		try {
		  	$ = _cheerio.load(body);
		  	_resp = $('div[class=id-app-title]').text();
	  	} catch(_i) {
	  	}
	  } else {
	  	_resp = this._appid; // if app-title is not found, return appid
	  }
	  cb(_resp);
	}.bind({ _appid:appid }))
};

// GET USING ADB PULL
var getApkPath = function(appid) {
	var _resp = _run(__dirname + _path.sep + 'bin/adb shell pm path '+appid).out.split('package:').join('');
	return _resp;
};
var getApkPull = function(appdir, appname, cb) {
	//console.log("running: "+__dirname + _path.sep + "bin/adb pull '"+appdir+"' '" + _cur_dir + _path.sep + appname + ".apk'");
	var _copy = _run(__dirname + _path.sep + "bin/adb pull '"+appdir+"' '" + _cur_dir + _path.sep + appname + ".apk'").out;
	//console.log('reply:'+_copy);
	if (_copy.indexOf('adb: error')>-1) {
		cb(false);
	} else {
		cb(true);
	}
};

// GET USING ANDROID BACKUP (unrooted devices)
var getAndroidBackup = function(appid, cb) {
	console.log('Please unlock the device and accept the backup.'.green);
	var _ab = _run(__dirname + _path.sep + 'bin/adb backup -apk '+appid);
	console.log('backup ready'.yellow);
	cb(true);
};

var androidBackup2apk = function(appid, appname, cb) {
	var _appname = appname; //.split('.').join(''); // clean char names.
	_progress = _ora({ text: 'Extracting APK from backup: '+appname, spinner:'dots5' }).start();
	var _cvt = _run('dd if='+_cur_dir + _path.sep + 'backup.ab bs=1 skip=24 | python -c "import zlib,sys;sys.stdout.write(zlib.decompress(sys.stdin.read()))" | tar -xvf -');
	_progress.color = 'green', _progress.text = 'almost ready';
	var _src = _cur_dir + _path.sep + 'apps' + _path.sep + appid + _path.sep + 'a' + _path.sep + 'base.apk';
	var _dst = _cur_dir + _path.sep + _appname + '.apk';
	_shell.mv(_src,_dst);
	// clean
	_progress.color = 'green', _progress.text = 'cleaning';
	fs.unlink(_cur_dir + _path.sep + 'backup.ab');
	var _full_appdir = _path.join(_cur_dir,'apps'+_path.sep);
	deleteFolderRecursive(_full_appdir);
	//
	cb(true);
};
// END USING ANDROID BACKUP

//test if there is an android device connected
var getPackages = function(cb) {
	var _is = _run(__dirname + _path.sep + 'bin/adb shell pm list packages -3');
	_packages = {}, _packnames = {};
	if (_is.code==0) {
		connected = true;
		_progress.color = 'cyan', _progress.text = 'reading packages';
		var _lines = _is.out.split('\n');
		// get real packages from device
		for (var line_f in _lines) {
			var line = _lines[line_f].split('package:').join('').trim();
			// check this package isn't within omit_packages
			var _inc = true;
			for (var _om in _omit_packages) {
				var _omit = _omit_packages[_om];
				if (_omit.indexOf('*')>-1) {
					// test if omit in inside line
					var _omit_s = _omit.split('*').join('');
					if (line.indexOf(_omit_s)!==-1) {
						_inc = false;
					}
				} else {
					// test if omit is exactly the same as line
					if (line==_omit) {
						_inc = false;
					}
				}
			}
			if (_inc && line!='') {
				_packages[line]='';
			}
		}
		// get packages realnames
		var _completed = 0;
		var _total = Object.keys(_packages).length;
		for (var _id in _packages) {
			getName(_id, function(real) {
				_packages[this._id] = real;
				_packnames[real] = this._id;
				_completed++;
				if (_completed == _total) {
					cb(_packages);
				}
			}.bind({ _id:_id }));
		}
		if (_total==0) cb([]);
		//
	} else {
		if (_is.error.indexOf('no devices found')!=-1) {
			connected = false;
			_progress.color = 'red', _progress.text = 'no android device detected';
			//console.log('apk_pull -> no connected android device detected !'.red);
		} else {
			_progress.color = 'red', _progress.text = 'error reading bin/adb';
			//console.log('apk_pull -> error reading bin/adb'.red,_is);
		}
		cb([]);
	}
};

var deleteFolderRecursive = function(path) {
  if( fs.existsSync(path) ) {
    fs.readdirSync(path).forEach(function(file,index){
      var curPath = path + "/" + file;
      if(fs.lstatSync(curPath).isDirectory()) { // recurse
        deleteFolderRecursive(curPath);
      } else { // delete file
        fs.unlinkSync(curPath);
      }
    });
    fs.rmdirSync(path);
  }
};

//CLI start
console.log('APK Pull - Get Any APK from Any Connected Android Device'.green);
_progress = _ora({ text: 'Detecting android devices', spinner:'dots5' }).start();
getPackages(function(data) {
	_progress.stop();
	// TODO: process arguments here : apk_pull appname [apkdir]
	if (connected==false) {
		console.log('apk_pull -> no connected android device detected !'.red);
	} else {
		if (args.length>=1) {
			// search data for appname or appid
			var _appid_required = '';
			for (var _i in data) {
				if (data[_i].toLowerCase()==args[0].toLowerCase()) {
					_appid_required = _i; 	//appname found, assign appid
				} else if (_i.toLowerCase()==args[0].toLowerCase()) {
					_appid_required = _i;	//appid found, assign appid
				}
			}
			//
			if (_appid_required!='') {
				var _apkpull = getApkPath(_appid_required);
				if (_apkpull!='') {
					// Get APK using ADB Pull
					getApkPull(_apkpull, _packages[_appid_required], function(result) {
						if (result) {
							_progress.stop();
							console.log('apk restored.'.green);
						} else {
							// there was an error using adb pull, retrieve using backup
							// Get APK Using Android Backup (unrooted devices)
							getAndroidBackup(_appid_required, function(ready) {
								androidBackup2apk(_appid_required,_packages[_appid_required],function(readyto) {
									_progress.stop();
									if (args.length==2) {
										// if apkdir given, move apk to that directory.
										// if apkdir doesn't exist, create it
									}
									console.log('apk restored.'.green);
								});
							});
						}
					});
				} else {
					// Get APK Using Android Backup (unrooted devices)
					getAndroidBackup(_appid_required, function(ready) {
						androidBackup2apk(_appid_required,_packages[_appid_required],function(readyto) {
							_progress.stop();
							if (args.length==2) {
								// if apkdir given, move apk to that directory.
								// if apkdir doesn't exist, create it
							}
							console.log('apk restored.'.green);
						});
					});
				}
			} else {
				console.log('appname or appid not found on device.');
			}
			//

		} else {
			// show menu
			var choices = [];
			for (var _i in data) {
				choices.push({ name:data[_i], value:_i });
			}
			if (choices.length==0) {
				_progress.stop();
				console.log('No real apps detected on device.'.red);
			} else {
				// show menu
				var inquirer = require('inquirer');
				choices.push(new inquirer.Separator());
				choices.push({ name:':: Exit ::', value:'_exit_' });
				choices.push(new inquirer.Separator());
				inquirer.prompt([
					{	type:'list',	
						name:'appid',	
						message:'Please select an app of your device:',
						choices:choices
					}
				]).then(function(answer) {
					if (answer.appid!='_exit_') {
						var _apkpull = getApkPath(answer.appid);
						if (_apkpull!='') {
							// Get APK using ADB Pull
							getApkPull(_apkpull, _packages[answer.appid], function(result) {
								if (result) {
									_progress.stop();
									console.log('apk restored.'.green);
								} else {
									// there was an error using adb pull, use Android Backup
									// Get APK using Android Backup (unrooted devices)
									getAndroidBackup(answer.appid, function(ready) {
										androidBackup2apk(answer.appid,_packages[answer.appid],function(readyto) {
											_progress.stop();
											console.log('apk restored.'.green);
										});
									});
									//
								}
							});
						} else {
							// Get APK using Android Backup (unrooted devices)
							getAndroidBackup(answer.appid, function(ready) {
								androidBackup2apk(answer.appid,_packages[answer.appid],function(readyto) {
									_progress.stop();
									console.log('apk restored.'.green);
								});
							});
						}
					} else {
						console.log('exit requested.'.yellow);
					}
				});
				// end menu
			}
		}
	}
});























