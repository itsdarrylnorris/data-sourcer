'use strict';

var _ = require('underscore');
var async = require('async');
var EventEmitter = require('events').EventEmitter || require('events');

module.exports = {

	homeUrl: null,
	defaultOptions: {
		numPagesToScrape: 10,
	},
	config: {
		startPageUrl: null,
		selectors: {
			item: null,
			itemAttributes: {
				ipAddress: null,
			},
			nextLink: null,
		},
		parseAttributes: {
			// ipAddress: '(.+)',
		},
	},

	getData: function(options) {

		var emitter = new EventEmitter();

		_.defer(function() {

			options = options || {};
			options.newPage(function(error, page) {

				var onData = _.bind(emitter.emit, emitter, 'data');
				var onError = _.bind(emitter.emit, emitter, 'error');
				var onEnd = _.once(function() {
					if (page && !page.isClosed()) {
						page.close().catch(onError);
						page = null;
					}
					emitter.emit('end');
				});

				if (error) {
					onError(error);
					return onEnd();
				}

				var scrapeFirstPage = this.goToStartPageAndScrapeData.bind(this, page);
				var scrapeNextPage = this.goToNextPageAndScrapeData.bind(this, page);
				var numPagesToScrape = options.sample ? 1 : options.sourceOptions.numPagesToScrape;

				scrapeFirstPage(function(error, data) {

					if (error) {
						onError(error);
						return onEnd();
					}

					onData(data);

					var numScraped = 1;
					var scrapedDataInLastPage = data.length > 0;
					var doContinueScraping = function() {
						return !!scrapedDataInLastPage && numScraped < numPagesToScrape;
					};

					if (!doContinueScraping()) {
						return onEnd();
					}

					async.until(doContinueScraping, function(next) {
						scrapeNextPage(function(error, data) {
							if (error) return next(error);
							scrapedDataInLastPage = data.length > 0;
							numScraped++;
							onData(data);
							next();
						});
					}, function(error) {
						if (error) onError(error);
						onEnd();
					});
				});

			}.bind(this));
		}.bind(this));

		return emitter;
	},

	goToStartPageAndScrapeData: function(page, done) {
		async.seq(
			this.goToStartPage.bind(this, page),
			this.waitForElement.bind(this, page, this.config.selectors.item),
			this.scrapeData.bind(this, page)
		)(done);
	},

	goToNextPageAndScrapeData: function(page, done) {
		async.seq(
			this.goToNextPage.bind(this, page),
			this.waitForElement.bind(this, page, this.config.selectors.item),
			this.scrapeData.bind(this, page)
		)(done);
	},

	goToStartPage: function(page, done) {
		this.navigate(page, this.config.startPageUrl, done);
	},

	goToNextPage: function(page, done) {
		async.seq(
			this.waitForElement.bind(this, page, this.config.selectors.nextLink),
			this.extractLinkUrl.bind(this, page, this.config.selectors.nextLink),
			this.navigate.bind(this, page)
		)(done);
	},

	navigate: function(page, goToUrl, done) {
		page.goto(goToUrl).then(function() {
			done();
		}).catch(done);
	},

	extractLinkUrl: function(page, selector, done) {
		page.evaluate(function(selector) {
			return new Promise(function(resolve, reject) {
				var linkUrl;
				try {
					var linkEl = document.querySelector(selector);
					if (!linkEl) {
						throw new Error('Could not find link element');
					}
					linkUrl = linkEl.href;
				} catch (error) {
					return reject(error.message);
				}
				resolve(linkUrl);
			});
		}, selector).then(function(linkUrl) {
			done(null, linkUrl);
		}).catch(done);
	},

	waitForElement: function(page, selector, done) {
		page.waitFor(selector).then(function() {
			done();
		}).catch(done);
	},

	scrapeData: function(page, done) {
		var config = this.config;
		done = _.once(done || _.noop);
		page.evaluate(function(config) {
			return new Promise(function(resolve, reject) {
				try {
					var data = [];
					var itemEls = document.querySelectorAll(config.selectors.item);
					if (itemEls) {
						for (var index = 0; index < itemEls.length; index++) {
							(function(itemEl) {
								var item = {};
								Object.keys(config.selectors.itemAttributes).forEach(function(key) {
									var selector = config.selectors.itemAttributes[key];
									var attrEl = itemEl.querySelector(selector);
									if (!attrEl) return;
									var value = attrEl.textContent;
									if (value) {
										item[key] = value;
									}
								});
								if (Object.keys(item).length > 0) {
									data.push(item);
								}
							})(itemEls[index]);
						}
					}
				} catch (error) {
					return reject(error);
				}
				return resolve(data);
			});
		}, config).then(function(data) {
			try {
				data = _.chain(data).map(function(item) {
					item = _.mapObject(item, function(value, key) {
						var parse = config.parseAttributes[key];
						if (parse) {
							if (_.isString(parse)) {
								var parseRegExp = new RegExp(parse);
								if (parseRegExp) {
									var match = value.match(parseRegExp);
									value = match && match[1] || null;
								}
							} else if (_.isFunction(parse)) {
								value = parse(value);
							}
						}
						return value;
					});
					return item;
				}).compact().value();
			} catch (error) {
				return done(error);
			}
			done(null, data);
		}).catch(done);
	},
};
