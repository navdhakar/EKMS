const express = require("express");
const path = require("path");
const router = express.Router();
const fs = require("fs");
const getSlug = require("speakingurl");
const common = require("./common");
const _ = require("lodash");
const mime = require("mime-types");
const url = require("url");
const junk = require("junk");
const walk = require("walk");
const mkdirp = require("mkdirp");
const multer = require("multer");
const glob = require("glob");
const multer_upload = require("multer");
const zipExtract = require("extract-zip");
const rimraf = require("rimraf");
const JSZip = require("jszip");
const sm = require("sitemap");
const classy = require("../public/javascripts/markdown-it-classy");
const config = common.read_config();

const appDir = path.dirname(require("require-main-filename")());

router.get("/", common.restrict, (req, res, next) => {
  const db = req.app.db;
  common.config_expose(req.app);
  const featuredCount = config.settings.featured_articles_count
    ? config.settings.featured_articles_count
    : 4;

  common.setTemplateDir("user", req);

  const sortByField =
    typeof config.settings.sort_by.field !== "undefined"
      ? config.settings.sort_by.field
      : "kb_viewcount";
  const sortByOrder =
    typeof config.settings.sort_by.order !== "undefined"
      ? config.settings.sort_by.order
      : -1;
  const sortBy = {};
  sortBy[sortByField] = sortByOrder;

  common.dbQuery(
    db.kb,
    { kb_published: "true" },
    sortBy,
    config.settings.num_top_results,
    (err, top_results) => {
      common.dbQuery(
        db.kb,
        { kb_published: "true", kb_featured: "true" },
        sortBy,
        featuredCount,
        (err, featured_results) => {
          res.render("index", {
            title: "EKMS",
            user_page: true,
            homepage: true,
            top_results: top_results,
            featured_results: featured_results,
            session: req.session,
            message: common.clear_session_value(req.session, "message"),
            message_type: common.clear_session_value(
              req.session,
              "message_type"
            ),
            config: config,
            current_url:
              req.protocol + "://" + req.get("host") + req.app_context,
            fullUrl: req.protocol + "://" + req.get("host") + req.originalUrl,
            helpers: req.handlebars,
            show_footer: "show_footer",
          });
        }
      );
    }
  );
});

router.get(
  "/" + config.settings.route_name + "/:id/version",
  common.restrict,
  (req, res) => {
    const db = req.app.db;
    common.config_expose(req.app);
    const markdownit = req.markdownit;
    markdownit.use(classy);

    if (!req.session.user) {
      res.render("error", {
        message: "404 - Page not found",
        helpers: req.handlebars,
        config: config,
      });
      return;
    }

    const sortByField =
      typeof config.settings.sort_by.field !== "undefined"
        ? config.settings.sort_by.field
        : "kb_viewcount";
    const sortByOrder =
      typeof config.settings.sort_by.order !== "undefined"
        ? config.settings.sort_by.order
        : -1;
    const sortBy = {};
    sortBy[sortByField] = sortByOrder;

    const featuredCount = config.settings.featured_articles_count
      ? config.settings.featured_articles_count
      : 4;

    db.kb.findOne({ _id: common.getId(req.params.id) }, (err, result) => {
      common.dbQuery(
        db.kb,
        { kb_published: "true", kb_versioned_doc: { $eq: true } },
        sortBy,
        featuredCount,
        (err, featured_results) => {
          res.render("kb", {
            title: result.kb_title,
            result: result,
            user_page: true,
            kb_body: common.sanitizeHTML(markdownit.render(result.kb_body)),
            featured_results: featured_results,
            config: config,
            session: req.session,
            current_url:
              req.protocol + "://" + req.get("host") + req.app_context,
            fullUrl: req.protocol + "://" + req.get("host") + req.originalUrl,
            message: common.clear_session_value(req.session, "message"),
            message_type: common.clear_session_value(
              req.session,
              "message_type"
            ),
            helpers: req.handlebars,
            show_footer: "show_footer",
          });
        }
      );
    });
  }
);

router.get(
  "/" + config.settings.route_name + "/:id",
  common.restrict,
  (req, res) => {
    const db = req.app.db;
    common.config_expose(req.app);
    const markdownit = req.markdownit;
    markdownit.use(classy);

    const featuredCount = config.settings.featured_articles_count
      ? config.settings.featured_articles_count
      : 4;

    common.setTemplateDir("user", req);

    const sortByField =
      typeof config.settings.sort_by.field !== "undefined"
        ? config.settings.sort_by.field
        : "kb_viewcount";
    const sortByOrder =
      typeof config.settings.sort_by.order !== "undefined"
        ? config.settings.sort_by.order
        : -1;
    const sortBy = {};
    sortBy[sortByField] = sortByOrder;

    db.kb.findOne(
      {
        $or: [
          { _id: common.getId(req.params.id) },
          { kb_permalink: req.params.id },
        ],
        kb_versioned_doc: { $ne: true },
      },
      (err, result) => {
        if (result == null || result.kb_published === "false") {
          res.render("error", {
            message: "404 - Page not found",
            helpers: req.handlebars,
            config: config,
          });
        } else {
          if (result.kb_password) {
            if (result.kb_password !== "") {
              if (
                req.session.pw_validated === "false" ||
                req.session.pw_validated === undefined ||
                req.session.pw_validated == null
              ) {
                res.render("protected_kb", {
                  title: "Protected Article",
                  result: result,
                  config: config,
                  session: req.session,
                  helpers: req.handlebars,
                });
                return;
              }
            }
          }

          if (
            typeof result.kb_visible_state !== "undefined" &&
            result.kb_visible_state === "private"
          ) {
            if (!req.session.user) {
              req.session.refer_url = req.originalUrl;
              res.redirect("/login");
              return;
            }
          }

          let old_viewcount = result.kb_viewcount;
          if (old_viewcount == null) {
            old_viewcount = 0;
          }

          let new_viewcount = old_viewcount;
          if (req.session.user && config.settings.update_view_count_logged_in) {
            new_viewcount = old_viewcount + 1;
          }

          if (!req.session.user) {
            new_viewcount = old_viewcount + 1;
          }

          if (config.settings.mermaid) {
            var mermaidChart = function (code) {
              return '<div class="mermaid">' + code + "</div>";
            };

            var defFenceRules = markdownit.renderer.rules.fence.bind(
              markdownit.renderer.rules
            );
            markdownit.renderer.rules.fence = function (
              tokens,
              idx,
              options,
              env,
              slf
            ) {
              var token = tokens[idx];
              var code = token.content.trim();
              if (token.info === "mermaid") {
                return mermaidChart(code);
              }
              var firstLine = code.split(/\n/)[0].trim();
              if (
                firstLine === "gantt" ||
                firstLine === "sequenceDiagram" ||
                firstLine.match(/^graph (?:TB|BT|RL|LR|TD);?$/)
              ) {
                return mermaidChart(code);
              }
              return defFenceRules(tokens, idx, options, env, slf);
            };
          }

          db.kb.update(
            {
              $or: [
                { _id: common.getId(req.params.id) },
                { kb_permalink: req.params.id },
              ],
            },
            {
              $set: { kb_viewcount: new_viewcount },
            },
            { multi: false },
            (err, numReplaced) => {
              req.session.pw_validated = null;

              common.dbQuery(
                db.kb,
                { kb_published: "true" },
                sortBy,
                featuredCount,
                (err, featured_results) => {
                  res.render("kb", {
                    title: result.kb_title,
                    result: result,
                    user_page: true,
                    kb_body: common.sanitizeHTML(
                      markdownit.render(result.kb_body)
                    ),
                    featured_results: featured_results,
                    config: config,
                    session: req.session,
                    current_url:
                      req.protocol + "://" + req.get("host") + req.app_context,
                    fullUrl:
                      req.protocol + "://" + req.get("host") + req.originalUrl,
                    message: common.clear_session_value(req.session, "message"),
                    message_type: common.clear_session_value(
                      req.session,
                      "message_type"
                    ),
                    helpers: req.handlebars,
                    show_footer: "show_footer",
                  });
                }
              );
            }
          );
        }
      }
    );
  }
);

router.get("/edit/:id", common.restrict, (req, res) => {
  const db = req.app.db;
  common.config_expose(req.app);
  db.kb.findOne(
    { _id: common.getId(req.params.id), kb_versioned_doc: { $ne: true } },
    (err, result) => {
      if (!result) {
        res.render("error", {
          message: "404 - Page not found",
          helpers: req.handlebars,
          config: config,
        });
        return;
      }

      common.dbQuery(
        db.kb,
        { kb_parent_id: req.params.id },
        { kb_last_updated: -1 },
        20,
        (err, versions) => {
          res.render("edit", {
            title: "Edit article",
            result: result,
            versions: versions,
            session: req.session,
            message: common.clear_session_value(req.session, "message"),
            message_type: common.clear_session_value(
              req.session,
              "message_type"
            ),
            config: config,
            editor: true,
            helpers: req.handlebars,
          });
        }
      );
    }
  );
});

router.post("/insert_kb", common.restrict, (req, res) => {
  const db = req.app.db;
  const lunr_index = req.app.index;

  const doc = {
    kb_permalink: req.body.frm_kb_permalink,
    kb_title: req.body.frm_kb_title,
    kb_body: req.body.frm_kb_body,
    kb_published: req.body.frm_kb_published,
    kb_keywords: req.body.frm_kb_keywords,
    kb_published_date: new Date(),
    kb_last_updated: new Date(),
    kb_last_update_user: req.session.users_name + " - " + req.session.user,
    kb_author: req.session.users_name,
    kb_author_email: req.session.user,
  };

  db.kb.count({ kb_permalink: req.body.frm_kb_permalink }, (err, kb) => {
    if (kb > 0 && req.body.frm_kb_permalink !== "") {
      req.session.message = req.i18n.__(
        "Permalink already exists. Pick a new one."
      );
      req.session.message_type = "danger";

      req.session.kb_title = req.body.frm_kb_title;
      req.session.kb_body = req.body.frm_kb_body;
      req.session.kb_keywords = req.body.frm_kb_keywords;
      req.session.kb_permalink = req.body.frm_kb_permalink;

      res.redirect(req.app_context + "/insert");
    } else {
      db.kb.insert(doc, (err, newDoc) => {
        if (err) {
          console.error("Error inserting document: " + err);

          req.session.kb_title = req.body.frm_kb_title;
          req.session.kb_body = req.body.frm_kb_body;
          req.session.kb_keywords = req.body.frm_kb_keywords;
          req.session.kb_permalink = req.body.frm_kb_permalink;

          req.session.message = req.i18n.__("Error") + ": " + err;
          req.session.message_type = "danger";

          res.redirect(req.app_context + "/insert");
        } else {
          let keywords = "";
          if (req.body.frm_kb_keywords !== undefined) {
            keywords = req.body.frm_kb_keywords.toString().replace(/,/g, " ");
          }

          let newId = newDoc._id;
          if (config.settings.database.type !== "embedded") {
            newId = newDoc.insertedIds[0];
          }

          const lunr_doc = {
            kb_title: req.body.frm_kb_title,
            kb_keywords: keywords,
            id: newId,
          };

          console.log("lunr_doc", lunr_doc);
          if (config.settings.index_article_body === true) {
            lunr_doc["kb_body"] = req.body.frm_kb_body;
          }

          lunr_index.add(lunr_doc);

          req.session.message = req.i18n.__("New article successfully created");
          req.session.message_type = "success";

          res.redirect(req.app_context + "/edit/" + newId);
        }
      });
    }
  });
});

router.post("/save_kb", common.restrict, (req, res) => {
  const db = req.app.db;
  const lunr_index = req.app.index;
  const kb_featured = req.body.frm_kb_featured === "on" ? "true" : "false";

  let keywords = req.body.frm_kb_keywords.replace(/<(?:.|\n)*?>/gm, "");
  if (common.safe_trim(keywords) === ",") {
    keywords = "";
  }

  db.kb.count(
    {
      kb_permalink: req.body.frm_kb_permalink,
      $not: { _id: common.getId(req.body.frm_kb_id) },
      kb_versioned_doc: { $ne: true },
    },
    (err, kb) => {
      if (kb > 0 && req.body.frm_kb_permalink !== "") {
        req.session.message = req.i18n.__(
          "Permalink already exists. Pick a new one."
        );
        req.session.message_type = "danger";

        req.session.kb_title = req.body.frm_kb_title;
        req.session.kb_body = req.body.frm_kb_body;
        req.session.kb_keywords = req.body.frm_kb_keywords;
        req.session.kb_permalink = req.body.frm_kb_permalink;
        req.session.kb_featured = kb_featured;
        req.session.kb_seo_title = req.body.frm_kb_seo_title;
        req.session.kb_seo_description = req.body.frm_kb_seo_description;
        req.session.kb_edit_reason = req.body.frm_kb_edit_reason;
        req.session.kb_visible_state = req.body.frm_kb_visible_state;

        // redirect to insert
        res.redirect(req.app_context + "/edit/" + req.body.frm_kb_id);
      } else {
        db.kb.findOne(
          { _id: common.getId(req.body.frm_kb_id) },
          (err, article) => {
            // update author if not set
            const author = article.kb_author
              ? article.kb_author
              : req.session.users_name;
            const author_email = article.kb_author_email
              ? article.kb_author_email
              : req.session.user;

            // set published date to now if none exists
            let published_date;
            if (
              article.kb_published_date == null ||
              article.kb_published_date === undefined
            ) {
              published_date = new Date();
            } else {
              published_date = article.kb_published_date;
            }

            // update our old doc
            db.kb.update(
              { _id: common.getId(req.body.frm_kb_id) },
              {
                $set: {
                  kb_title: req.body.frm_kb_title,
                  kb_body: req.body.frm_kb_body,
                  kb_published: req.body.frm_kb_published,
                  kb_keywords: keywords,
                  kb_last_updated: new Date(),
                  kb_last_update_user:
                    req.session.users_name + " - " + req.session.user,
                  kb_author: author,
                  kb_author_email: author_email,
                  kb_published_date: published_date,
                  kb_password: req.body.frm_kb_password,
                  kb_permalink: req.body.frm_kb_permalink,
                  kb_featured: kb_featured,
                  kb_seo_title: req.body.frm_kb_seo_title,
                  kb_seo_description: req.body.frm_kb_seo_description,
                  kb_visible_state: req.body.frm_kb_visible_state,
                },
              },
              {},
              (err, numReplaced) => {
                if (err) {
                  console.error("Failed to save KB: " + err);
                  req.session.message = req.i18n.__(
                    "Failed to save. Please try again"
                  );
                  req.session.message_type = "danger";
                  res.redirect(req.app_context + "/edit/" + req.body.frm_kb_id);
                } else {
                  // setup keywords
                  let keywords = "";
                  if (req.body.frm_kb_keywords !== undefined) {
                    keywords = req.body.frm_kb_keywords
                      .toString()
                      .replace(/,/g, " ");
                  }

                  // create lunr doc
                  const lunr_doc = {
                    kb_title: req.body.frm_kb_title,
                    kb_keywords: keywords,
                    id: req.body.frm_kb_id,
                  };

                  // if index body is switched on
                  if (config.settings.index_article_body === true) {
                    lunr_doc["kb_body"] = req.body.frm_kb_body;
                  }

                  // update the index
                  lunr_index.update(lunr_doc, false);

                  // check if versioning enabled
                  const article_versioning = config.settings.article_versioning
                    ? config.settings.article_versioning
                    : false;

                  // if versions turned on, insert a doc to track versioning
                  if (article_versioning === true) {
                    // version doc
                    const version_doc = {
                      kb_title: req.body.frm_kb_title,
                      kb_parent_id: req.body.frm_kb_id,
                      kb_versioned_doc: true,
                      kb_edit_reason: req.body.frm_kb_edit_reason,
                      kb_body: req.body.frm_kb_body,
                      kb_published: false,
                      kb_keywords: keywords,
                      kb_last_updated: new Date(),
                      kb_last_update_user:
                        req.session.users_name + " - " + req.session.user,
                      kb_author: author,
                      kb_author_email: author_email,
                      kb_published_date: published_date,
                      kb_password: req.body.frm_kb_password,
                      kb_permalink: req.body.frm_kb_permalink,
                      kb_featured: kb_featured,
                      kb_seo_title: req.body.frm_kb_seo_title,
                      kb_seo_description: req.body.frm_kb_seo_description,
                    };

                    // insert a doc to track versioning
                    db.kb.insert(version_doc, (err, version_doc) => {
                      req.session.message = req.i18n.__("Successfully saved");
                      req.session.message_type = "success";
                      res.redirect(
                        req.app_context + "/edit/" + req.body.frm_kb_id
                      );
                    });
                  } else {
                    req.session.message = req.i18n.__("Successfully saved");
                    req.session.message_type = "success";
                    res.redirect(
                      req.app_context + "/edit/" + req.body.frm_kb_id
                    );
                  }
                }
              }
            );
          }
        );
      }
    }
  );
});
router.get("/logout", (req, res) => {
  req.session.user = null;
  req.session.users_name = null;
  req.session.is_admin = null;
  req.session.pw_validated = null;
  req.session.message = null;
  req.session.message_type = null;
  res.redirect(req.app_context + "/");
});

router.get("/users", common.restrict, (req, res) => {
  if (req.session.is_admin !== "true") {
    res.render("error", {
      message: "Access denied",
      helpers: req.handlebars,
      config: config,
    });
    return;
  }

  const db = req.app.db;
  common.dbQuery(db.users, {}, null, null, (err, users) => {
    res.render("users", {
      title: "Users",
      users: users,
      config: config,
      is_admin: req.session.is_admin,
      helpers: req.handlebars,
      session: req.session,
      message: common.clear_session_value(req.session, "message"),
      message_type: common.clear_session_value(req.session, "message_type"),
    });
  });
});

// users
router.get("/user/edit/:id", common.restrict, (req, res) => {
  const db = req.app.db;
  db.users.findOne({ _id: common.getId(req.params.id) }, (err, user) => {
    if (
      user.user_email !== req.session.user &&
      req.session.is_admin === "false"
    ) {
      req.session.message = req.i18n.__("Access denied");
      req.session.message_type = "danger";
      res.redirect(req.app_context + "/Users/");
      return;
    }

    res.render("user_edit", {
      title: "User edit",
      user: user,
      session: req.session,
      message: common.clear_session_value(req.session, "message"),
      message_type: common.clear_session_value(req.session, "message_type"),
      helpers: req.handlebars,
      config: config,
    });
  });
});

router.get("/users/new", common.restrict, (req, res) => {
  if (req.session.is_admin !== "true") {
    res.render("error", {
      message: "Access denied",
      helpers: req.handlebars,
      config: config,
    });
    return;
  }

  res.render("user_new", {
    title: "User - New",
    session: req.session,
    message: common.clear_session_value(req.session, "message"),
    message_type: common.clear_session_value(req.session, "message_type"),
    config: config,
    helpers: req.handlebars,
  });
});

router.get("/articles", common.restrict, (req, res) => {
  const db = req.app.db;
  common.dbQuery(
    db.kb,
    { kb_versioned_doc: { $ne: true } },
    { kb_published_date: -1 },
    10,
    (err, articles) => {
      res.render("articles", {
        title: "Articles",
        articles: articles,
        session: req.session,
        message: common.clear_session_value(req.session, "message"),
        message_type: common.clear_session_value(req.session, "message_type"),
        config: config,
        helpers: req.handlebars,
      });
    }
  );
});

router.get("/articles/all", common.restrict, (req, res) => {
  const db = req.app.db;
  common.dbQuery(
    db.kb,
    { kb_versioned_doc: { $ne: true } },
    { kb_published_date: -1 },
    null,
    (err, articles) => {
      res.render("articles", {
        title: "Articles",
        articles: articles,
        session: req.session,
        message: common.clear_session_value(req.session, "message"),
        message_type: common.clear_session_value(req.session, "message_type"),
        config: config,
        helpers: req.handlebars,
      });
    }
  );
});

router.post("/published_state", common.restrict, (req, res) => {
  const db = req.app.db;
  db.kb.update(
    { _id: common.getId(req.body.id) },
    { $set: { kb_published: req.body.state } },
    { multi: false },
    (err, numReplaced) => {
      if (err) {
        console.error("Failed to update the published state: " + err);
        res.writeHead(400, { "Content-Type": "application/text" });
        res.end("Published state not updated");
      } else {
        res.writeHead(200, { "Content-Type": "application/text" });
        res.end("Published state updated");
      }
    }
  );
});

router.post("/user_insert", common.restrict, (req, res) => {
  const db = req.app.db;
  const bcrypt = req.bcrypt;
  const saltRounds = 10;

  const url_parts = url.parse(req.header("Referer"));

  let is_admin = "false";
  if (
    typeof config.settings.app_context !== "undefined" &&
    config.settings.app_context !== ""
  ) {
    if (url_parts.path === "/" + config.settings.app_context + "/setup") {
      is_admin = "true";
    }
  } else if (url_parts.path === "/setup") {
    is_admin = "true";
  }

  const doc = {
    users_name: req.body.users_name,
    user_email: req.body.user_email,
    user_password: bcrypt.hashSync(req.body.user_password, saltRounds),
    is_admin: is_admin,
  };

  db.users.findOne({ user_email: req.body.user_email }, (err, user) => {
    if (user) {
      console.error("Failed to insert user, possibly already exists: " + err);
      req.session.message = req.i18n.__(
        "A user with that email address already exists"
      );
      req.session.message_type = "danger";
      res.redirect(req.app_context + "/users/new");
    } else {
      db.users.insert(doc, (err, doc) => {
        if (err) {
          console.error("Failed to insert user: " + err);
          req.session.message = req.i18n.__("User exists");
          req.session.message_type = "danger";
          res.redirect(req.app_context + "/user/edit/" + doc._id);
          return;
        }
        req.session.message = req.i18n.__("User account inserted");
        req.session.message_type = "success";

        if (url_parts.path === "/setup") {
          req.session.user = req.body.user_email;
          res.redirect(req.app_context + "/login");
          return;
        }
        res.redirect(req.app_context + "/users");
      });
    }
  });
});

router.post("/user_update", common.restrict, (req, res) => {
  const db = req.app.db;
  const bcrypt = req.bcrypt;
  let is_admin = req.body.user_admin === "on" ? "true" : "false";

  db.users.findOne({ _id: common.getId(req.body.user_id) }, (err, user) => {
    if (
      user.user_email !== req.session.user &&
      req.session.is_admin === "false"
    ) {
      req.session.message = req.i18n.__("Access denied");
      req.session.message_type = "danger";
      res.redirect(req.app_context + "/Users/");
      return;
    }
    if (user.user_email === req.session.user) {
      is_admin = user.is_admin;
    }

    const update_doc = {};
    const saltRounds = 10;
    update_doc.is_admin = is_admin;
    update_doc.users_name = req.body.users_name;
    if (req.body.user_password) {
      update_doc.user_password = bcrypt.hashSync(
        req.body.user_password,
        saltRounds
      );
    }

    db.users.update(
      { _id: common.getId(req.body.user_id) },
      {
        $set: update_doc,
      },
      { multi: false },
      (err, numReplaced) => {
        if (err) {
          console.error("Failed updating user: " + err);
          req.session.message = req.i18n.__("Failed to update user");
          req.session.message_type = "danger";
          res.redirect(req.app_context + "/user/edit/" + req.body.user_id);
        } else {
          req.session.message = req.i18n.__("User account updated.");
          req.session.message_type = "success";
          res.redirect(req.app_context + "/user/edit/" + req.body.user_id);
        }
      }
    );
  });
});

router.get("/login", (req, res) => {
  const db = req.app.db;
  common.setTemplateDir("admin", req);

  db.users.count({}, (err, user_count) => {
    if (user_count > 0) {
      req.session.needs_setup = false;

      let referringUrl = req.header("Referer");
      if (
        typeof req.session.refer_url !== "undefined" &&
        req.session.refer_url !== ""
      ) {
        referringUrl = req.session.refer_url;
      }

      res.render("login", {
        title: "Login",
        referring_url: referringUrl,
        config: config,
        message: common.clear_session_value(req.session, "message"),
        message_type: common.clear_session_value(req.session, "message_type"),
        show_footer: "show_footer",
        helpers: req.handlebars,
      });
    } else {
      req.session.needs_setup = true;
      res.redirect(req.app_context + "/setup");
    }
  });
});

router.get("/setup", (req, res) => {
  const db = req.app.db;
  db.users.count({}, (err, user_count) => {
    req.session.needs_setup = false;
    if (user_count === 0) {
      res.render("setup", {
        title: "Setup",
        config: config,
        message: common.clear_session_value(req.session, "message"),
        message_type: common.clear_session_value(req.session, "message_type"),
        show_footer: "show_footer",
        helpers: req.handlebars,
      });
    } else {
      res.redirect(req.app_context + "/login");
    }
  });
});

router.get("/file_cleanup", common.restrict, (req, res) => {
  const db = req.app.db;
  const walkPath = path.join(appDir, "public", "uploads", "inline_files");
  const walker = walk.walk(walkPath, { followLinks: false });

  if (req.session.is_admin !== "true") {
    res.render("error", {
      message: "Access denied",
      helpers: req.handlebars,
      config: config,
    });
    return;
  }

  walker.on("file", (root, stat, next) => {
    const file_name = path.resolve(root, stat.name);

    common.dbQuery(
      db.kb,
      { kb_body: new RegExp(stat.name) },
      null,
      null,
      (err, posts) => {
        if (posts.length === 0) {
          fs.unlinkSync(file_name);
        }
        next();
      }
    );
  });

  walker.on("end", () => {
    req.session.message = req.i18n.__("All unused files have been removed");
    req.session.message_type = "success";
    res.redirect(req.app_context + req.header("Referer"));
  });
});

router.post("/login_action", (req, res) => {
  const db = req.app.db;
  const bcrypt = req.bcrypt;

  db.users.findOne({ user_email: req.body.email }, (err, user) => {
    if (user === undefined || user === null) {
      req.session.message = req.i18n.__(
        "A user with that email does not exist."
      );
      req.session.message_type = "danger";
      res.redirect(req.app_context + "/login");
    } else {
      if (bcrypt.compareSync(req.body.password, user.user_password) === true) {
        req.session.user = req.body.email;
        req.session.users_name = user.users_name;
        req.session.user_id = user._id.toString();
        req.session.is_admin = user.is_admin;
        if (
          req.body.frm_referring_url === undefined ||
          req.body.frm_referring_url === ""
        ) {
          res.redirect(req.app_context + "/");
        } else {
          const url_parts = url.parse(req.body.frm_referring_url, true);
          if (
            url_parts.pathname !== "/setup" &&
            url_parts.pathname !== req.app_context + "/login"
          ) {
            res.redirect(req.body.frm_referring_url);
          } else {
            res.redirect(req.app_context + "/");
          }
        }
      } else {
        req.session.message = req.i18n.__(
          "Access denied. Check password and try again."
        );
        req.session.message_type = "danger";
        res.redirect(req.app_context + "/login");
      }
    }
  });
});

router.get("/user/delete/:id", common.restrict, (req, res) => {
  if (req.session.is_admin !== "true") {
    res.render("error", {
      message: "Access denied",
      helpers: req.handlebars,
      config: config,
    });
    return;
  }

  const db = req.app.db;
  if (req.session.is_admin === "true") {
    db.users.remove(
      { _id: common.getId(req.params.id) },
      {},
      (err, numRemoved) => {
        req.session.message = req.i18n.__("User deleted.");
        req.session.message_type = "success";
        res.redirect(req.app_context + "/users");
      }
    );
  } else {
    req.session.message = req.i18n.__("Access denied.");
    req.session.message_type = "danger";
    res.redirect(req.app_context + "/users");
  }
});

router.get("/delete/:id", common.restrict, (req, res) => {
  const db = req.app.db;
  const lunr_index = req.app.index;

  db.kb.remove({ _id: common.getId(req.params.id) }, {}, (err, numRemoved) => {
    const lunr_doc = {
      id: req.params.id,
    };

    lunr_index.remove(lunr_doc, false);

    req.session.message = req.i18n.__("Article successfully deleted");
    req.session.message_type = "success";
    res.redirect(req.app_context + "/articles");
  });
});

const inline_upload = multer_upload({
  dest: path.join(appDir, "public", "uploads", "inline_files"),
});
router.post(
  "/file/upload_file",
  common.restrict,
  inline_upload.single("file"),
  (req, res, next) => {
    if (req.file) {
      const upload_dir = path.join(appDir, "public", "uploads", "inline_files");
      const relative_upload_dir = req.app_context + "/uploads/inline_files";

      const file = req.file;
      const source = fs.createReadStream(file.path);
      const dest = fs.createWriteStream(
        path.join(upload_dir, file.originalname)
      );

      source.pipe(dest);
      source.on("end", () => {});

      fs.unlink(file.path, (err) => {});

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          filename: relative_upload_dir + "/" + file.originalname,
        })
      );
      return;
    }
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ filename: "fail" }, null, 3));
  }
);

router.get("/insert", common.restrict, (req, res) => {
  res.render("insert", {
    title: "Insert new",
    session: req.session,
    kb_title: common.clear_session_value(req.session, "kb_title"),
    kb_body: common.clear_session_value(req.session, "kb_body"),
    kb_keywords: common.clear_session_value(req.session, "kb_keywords"),
    kb_permalink: common.clear_session_value(req.session, "kb_permalink"),
    message: common.clear_session_value(req.session, "message"),
    message_type: common.clear_session_value(req.session, "message_type"),
    editor: true,
    helpers: req.handlebars,
    config: config,
  });
});

router.get("/topic", (req, res) => {
  res.redirect("/");
});

router.post("/search", common.restrict, (req, res) => {
  const db = req.app.db;
  common.config_expose(req.app);
  const search_term = req.body.frm_search;
  const lunr_index = req.app.index;

  const lunr_id_array = [];
  lunr_index.search(search_term).forEach((id) => {
    console.log(id);
    if (config.settings.database.type !== "embedded") {
      lunr_id_array.push(common.getId(id.ref));
    } else {
      lunr_id_array.push(id.ref);
    }
  });

  const featuredCount = config.settings.featured_articles_count
    ? config.settings.featured_articles_count
    : 4;

  const sortByField =
    typeof config.settings.sort_by.field !== "undefined"
      ? config.settings.sort_by.field
      : "kb_viewcount";
  const sortByOrder =
    typeof config.settings.sort_by.order !== "undefined"
      ? config.settings.sort_by.order
      : -1;
  const sortBy = {};
  sortBy[sortByField] = sortByOrder;

  common.dbQuery(
    db.kb,
    {
      _id: { $in: lunr_id_array },
      kb_published: "true",
      kb_versioned_doc: { $ne: true },
    },
    null,
    null,
    (err, results) => {
      common.dbQuery(
        db.kb,
        { kb_published: "true", kb_featured: "true" },
        sortBy,
        featuredCount,
        (err, featured_results) => {
          res.render("index", {
            title: "Search results: " + search_term,
            search_results: results,
            user_page: true,
            session: req.session,
            search_term: search_term,
            featured_results: featured_results,
            message: common.clear_session_value(req.session, "message"),
            message_type: common.clear_session_value(
              req.session,
              "message_type"
            ),
            config: config,
            helpers: req.handlebars,
            show_footer: "show_footer",
          });
        }
      );
    }
  );
});

module.exports = router;
