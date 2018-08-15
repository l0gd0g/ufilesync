"use strict";

const Decorator = require("./index");
const fs = require("fs-extra");
const async = require("async");

class DecoratorCopy extends Decorator {
	constructor(uSync, config) {
		super("copy", uSync, config);
	}

	generateTaskFromScanDir(pathDir, isReplace, cb) {
		const decorator = this;
		fs.readdir(pathDir, (err, listItems) => {
			if (err) {
				return cb(err);
			}
			async.eachSeries(
				listItems,
				(dir, cb) => {
					const path = `${pathDir}/${dir}`;
					const make = (err, stats) => {
						if (err) {
							return cb(err);
						}

						if (stats.isDirectory()) {
							// Отправляем в очередь на синхронизацию
							decorator.uSync.push(
								decorator.uSync.task("mkdirp", path, "copy recursive"),
								err => {
									if (err) {
										return cb(err);
									}

									decorator.generateTaskFromScanDir(path, isReplace, cb);
								}
							);
						} else if (stats.isSymbolicLink()) {
							// Если файл уже существует, то создавать еще один не стоит
							fs.lstat(path, err => {
								// Если файл есть и не стоит опция "заменять" - выходим
								if (!err && isReplace === false) {
									// Вызываем cb который передал программист
									return cb();
								}

								fs.readlink(path, (err, linkPath) => {
									if (err) {
										return cb(err);
									}

									// Отправляем в очередь на синхронизацию
									decorator.uSync.push(
										decorator.uSync.task(
											"unlink",
											path,
											"copy symlink from generateTaskFromScanDir"
										),
										err => {
											if (err) {
												return cb(err);
											}
											decorator.uSync.push(
												decorator.uSync.task(
													"symlink", {
														src: linkPath,
														dest: path
													},
													"copy symlink from generateTaskFromScanDir"
												),
												cb
											);
										}
									);
								});
							});
						} else {
							// Отправляем в очередь на синхронизацию
							decorator.uSync.push(
								decorator.uSync.task("writeFile", path, "copy recursive"),
								cb
							);
						}
					};
					fs.lstat(path, make);
				},
				cb
			);
		});
	}

	wrapOriginCb(arg, fsMe, task) {
		const decorator = this;

		// "Вырезаем" колбек котрый должен быть
		const cbOrigin = arg.pop();

		let isReplace = false;
		// Если задали опцию копирования с заменой, то и задачи строим под них
		if (typeof arg[2] === "object" && arg[2].replace) isReplace = true;

		const debug = (mark, description) => {
			const name = `${decorator.functionName}(${task.id})`;
			const path = JSON.stringify(task.path);
			decorator.uSync.debug(
				task,
				`${name} ${mark} | ${description}ms | ${path}`
			);
		};

		// подменяем на свой
		arg.push((...argCb) => {

			// Если при выполнении функции возникла ошибка, то НЕ отправляем на синхронизацию
			if (argCb[0]) {
				debug("error", task.getTimeElapsed());

				// Вызываем cb который передал программист
				cbOrigin.apply(fsMe, argCb);
				return;
			}

			debug("fs end", task.getTimeElapsed());

			if (decorator.functionName !== "copy") {
				// Отправляем в очередь на синхронизацию
				decorator.uSync.push(task, err => {
					debug("push", task.getTimeElapsed());
					if (err) {
						debug("push", err);
						cbOrigin(err);
						return;
					}
					// Вызываем cb который передал программист
					cbOrigin.apply(fsMe, argCb);
				});
			}

			fs.lstat(task.path.src, (err, stats) => {
				if (err) {
					return cbOrigin(err);
				}

				if (stats.isDirectory()) {
					decorator.generateTaskFromScanDir(
						task.path.dest,
						isReplace,
						err => {
							if (err) {
								return cbOrigin(err);
							}
							debug("push", task.getTimeElapsed());
							// Вызываем cb который передал программист
							cbOrigin.apply(fsMe, argCb);
						}
					);
				} else if (stats.isSymbolicLink()) {
					// Если файл уже существует, то создавать еще один не стоит
					fs.lstat(task.path.dest, err => {
						// Если файл есть и не стоит опция "заменять" - выходим
						if (!err && isReplace === false) {
							// Вызываем cb который передал программист
							return cbOrigin.apply(fsMe, argCb);
						}

						fs.readlink(task.path.src, (err, linkPath) => {
							if (err) return cbOrigin(err);

							// Отправляем в очередь на синхронизацию
							decorator.uSync.push(
								decorator.uSync.task(
									"unlink",
									task.path.dest,
									"copy symlink from copy"
								),
								err => {
									debug("push unlink", task.getTimeElapsed());
									if (err) {
										return cbOrigin(err);
									}
									decorator.uSync.push(
										decorator.uSync.task(
											"symlink", {
												src: linkPath,
												dest: task.path.dest
											},
											"copy symlink from copy"
										),
										err => {
											debug("push symlink", task.getTimeElapsed());
											if (err) {
												return cbOrigin(err);
											}
											// Вызываем cb который передал программист
											cbOrigin.apply(fsMe, argCb);
										}
									);

								}
							);
						});
					});
				} else {
					// Отправляем в очередь на синхронизацию
					decorator.uSync.push(task, err => {
						debug("push", task.getTimeElapsed());
						if (err) {
							return cbOrigin(err);
						}
						// Вызываем cb который передал программист
						cbOrigin.apply(fsMe, argCb);
					});
				}
			});


		});
	}
}

module.exports = DecoratorCopy;
