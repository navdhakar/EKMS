const path = require("path");
const fs = require("fs");
const lunr = require("lunr");
const ObjectID = require("mongodb").ObjectID;
const sanitizeHtml = require("sanitize-html");

exports.clear_session_value = function (session, session_var) {
  const temp = session[session_var];
  session[session_var] = null;
  return temp;
};

exports.read_config = function () {
  const configFile = path.join(__dirname, "..", "config", "config.json");

  const defaultConfigFile = path.join(__dirname, "config.js");
  if (fs.existsSync(defaultConfigFile) === true) {
    const dir = path.join(__dirname, "..", "config");
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir);
    }

    const tempconfig = fs.readFileSync(defaultConfigFile, "utf8");
    fs.writeFileSync(configFile, tempconfig, "utf8");
    fs.unlinkSync(defaultConfigFile);
  }
  const rawData = fs.readFileSync(configFile, "utf8");
  const loadedConfig = JSON.parse(rawData);

  if (loadedConfig.settings.database.type === "mongodb") {
    loadedConfig.settings.database.connection_string =
      process.env.MONGODB_CONNECTION_STRING ||
      loadedConfig.settings.database.connection_string;
  }

  if (
    typeof loadedConfig.settings.route_name === "undefined" ||
    loadedConfig.settings.route_name === ""
  ) {
    loadedConfig.settings.route_name = "kb";
  }

  let environment = ".min";
  if (
    process.env.NODE_ENV === "development" ||
    process.env.NODE_ENV === undefined
  ) {
    environment = "";
  }
  loadedConfig.settings.env = environment;

  return loadedConfig;
};

exports.buildIndex = function (db, callback) {
  const config = this.read_config();
  exports.dbQuery(
    db.kb,
    { kb_published: "true" },
    null,
    null,
    (err, kb_list) => {
      const index = new lunr.Index();
      index.field("kb_title");
      index.field("kb_keywords");
      index.ref("id");

      if (config.settings.index_article_body === true) {
        index.field("kb_body");
      }

      kb_list.forEach((kb) => {
        let keywords = "";
        if (kb.kb_keywords !== undefined) {
          keywords = kb.kb_keywords.toString().replace(/,/g, " ");
        }

        const doc = {
          kb_title: kb.kb_title,
          kb_keywords: keywords,
          id: kb._id,
        };

        if (config.settings.index_article_body === true) {
          doc["kb_body"] = kb.kb_body;
        }

        index.add(doc);
      });
      callback(index);
    }
  );
};

exports.validate_permalink = function (db, data, callback) {
  if (typeof data.kb_permalink === "undefined" || data.kb_permalink === "") {
    callback(null, "All good");
  } else {
    db.kb.count({ kb_permalink: data.kb_permalink }, (err, kb) => {
      if (kb > 0) {
        callback("Permalink already exists", null);
      } else {
        callback(null, "All good");
      }
    });
  }
};

exports.restrict = function (req, res, next) {
  const config = exports.read_config();
  const url_path = req.url;

  if (url_path.substring(0, 5).trim() === "/") {
    if (config.settings.password_protect === false) {
      next();
      return;
    }
  }
  if (
    url_path.substring(0, 7) === "/search" ||
    url_path.substring(0, 6) === "/topic"
  ) {
    if (config.settings.password_protect === false) {
      next();
      return;
    }
  }

  if (
    url_path.substring(0, config.settings.route_name.length + 1) ===
    "/" + config.settings.route_name
  ) {
    if (config.settings.password_protect === false) {
      next();
      return;
    }
  }

  if (url_path.substring(0, 12) === "/user_insert") {
    next();
    return;
  }

  if (req.session.needs_setup === true) {
    res.redirect(req.app_context + "/setup");
    return;
  }

  if (config.settings.allow_query_param === true) {
    if (url_path.substring(0, 2).trim() === "/?") {
      if (config.settings.password_protect === false) {
        next();
        return;
      }
    }
  }

  exports.check_login(req, res, next);
};

exports.check_login = function (req, res, next) {
  exports.setTemplateDir("admin", req);

  if (req.session.user) {
    next();
  } else {
    res.redirect(req.app_context + "/login");
  }
};

exports.config_expose = function (app) {
  const config = exports.read_config();
  const clientConfig = {};
  clientConfig.route_name =
    config.settings.route_name !== undefined
      ? config.settings.route_name
      : "kb";
  clientConfig.add_header_anchors =
    config.settings.add_header_anchors !== undefined
      ? config.settings.add_header_anchors
      : false;
  clientConfig.links_blank_page =
    config.settings.links_blank_page !== undefined
      ? config.settings.links_blank_page
      : true;
  clientConfig.typeahead_search =
    config.settings.typeahead_search !== undefined
      ? config.settings.typeahead_search
      : true;
  clientConfig.enable_spellchecker =
    config.settings.enable_spellchecker !== undefined
      ? config.settings.enable_spellchecker
      : true;
  clientConfig.mermaid =
    config.settings.mermaid !== undefined ? config.settings.mermaid : false;
  clientConfig.mermaid_options = config.settings.mermaid_options;
  clientConfig.mermaid_auto_update =
    config.settings.mermaid_auto_update !== undefined
      ? config.settings.mermaid_auto_update
      : true;
  app.expose(clientConfig, "config");
};

exports.setTemplateDir = function (type, req) {
  const config = exports.read_config();
  if (type !== "admin") {
    const layoutDir = config.settings.theme
      ? path.join(
          __dirname,
          "../public/themes/",
          config.settings.theme,
          "/views/layouts/layout.hbs"
        )
      : path.join(__dirname, "../views/layouts/layout.hbs");
    const viewDir = config.settings.theme
      ? path.join(
          __dirname,
          "../public/themes/",
          config.settings.theme,
          "/views"
        )
      : path.join(__dirname, "../views");

    req.app.locals.settings.views = viewDir;
    req.app.locals.layout = layoutDir;
  } else {
    req.app.locals.settings.views = path.join(__dirname, "../views/");
    req.app.locals.layout = path.join(__dirname, "../views/layouts/layout.hbs");
  }
};

exports.getId = function (id) {
  const config = exports.read_config();
  if (config.settings.database.type === "embedded") {
    return id;
  }
  if (id.length !== 24) {
    return id;
  }

  let returnID = "";
  try {
    returnID = ObjectID(id);
    return returnID;
  } catch (ex) {
    return id;
  }
};

exports.sanitizeHTML = function (html) {
  return sanitizeHtml(html, {
    allowedTags: [
      "h1",
      "h2",
      "h3",
      "h4",
      "h5",
      "h6",
      "blockquote",
      "p",
      "a",
      "ul",
      "ol",
      "nl",
      "li",
      "b",
      "i",
      "strong",
      "em",
      "strike",
      "code",
      "hr",
      "br",
      "div",
      "table",
      "thead",
      "caption",
      "tbody",
      "tr",
      "th",
      "td",
      "pre",
      "img",
      "iframe",
    ],
    allowedAttributes: false,
  });
};

exports.dbQuery = function (db, query, sort, limit, callback) {
  const config = exports.read_config();
  if (config.settings.database.type === "embedded") {
    if (sort && limit) {
      db.find(query)
        .sort(sort)
        .limit(parseInt(limit))
        .exec((err, results) => {
          callback(null, results);
        });
    } else {
      db.find(query).exec((err, results) => {
        callback(null, results);
      });
    }
  } else {
    if (sort && limit) {
      db.find(query)
        .sort(sort)
        .limit(parseInt(limit))
        .toArray((err, results) => {
          callback(null, results);
        });
    } else {
      db.find(query).toArray((err, results) => {
        callback(null, results);
      });
    }
  }
};

exports.safe_trim = function (str) {
  if (str !== undefined) {
    return str.trim();
  }
  return str;
};
