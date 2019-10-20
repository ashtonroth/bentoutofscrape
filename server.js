var express = require("express");
var bodyParser = require("body-parser");
var logger = require("morgan");
var mongoose = require("mongoose");
var exphbs = require("express-handlebars");
var path = require("path");


// Our scraping tools
// Axios is a promised-based http library, similar to jQuery's Ajax method
// It works on the client and on the server
var axios = require("axios");
var cheerio = require("cheerio");

// Requiring Note and Article models
var Note = require("./models/Note.js");
var Article = require("./models/Article.js");

// Scraping tools
var request = require("request");


// Set mongoose to leverage built in JavaScript ES6 Promises
mongoose.Promise = Promise;

//Define port
var PORT = process.env.PORT || 2000

// Initialize Express
var app = express();

// Use morgan and body parser with our app
app.use(logger("dev"));
app.use(bodyParser.urlencoded({
  extended: false
}));

// Make public a static dir
app.use(express.static("public"));



app.engine("handlebars", exphbs({
    defaultLayout: "main",
    partialsDir: path.join(__dirname, "/views/layouts/partials")
}));
app.set("view engine", "handlebars");

var db = mongoose.connection;



// Show any mongoose errors
db.on("error", function(error) {
  console.log("Mongoose Error: ", error);
});

// Once logged in to the db through mongoose, log a success message
db.once("open", function() {
  console.log("Mongoose successfully listening.");
});

// Routes
// ======

//GET requests to render Handlebars pages
app.get("/", function(req, res) {
  Article.find({"saved": false}, function(error, data) {
    var hbsObject = {
      article: data
    };
    res.render("home", hbsObject);
  });
});

app.get("/saved", function(req, res) {
  Article.find({"saved": true}).populate("notes").exec(function(error, articles) {
    var hbsObject = {
      article: articles
    };
    res.render("saved", hbsObject);
  });
});


// Database configuration with mongoose
var MONGODB_URI = process.env.MONGODB_URI || "mongodb://localhost/mongoHeadlines";

mongoose.connect(MONGODB_URI);


// A GET request to scrape the Washington Post - Lifestyle website
app.get("/scrape", function(req, res) {
  
    // Delete existing unsaved articles from the db
    Article.deleteMany({saved : false}).then(function() {
         console.log("deleted articles");
    });

    // Get the page using axios
    axios.get("https://www.washingtonpost.com/lifestyle/").then(function(response) {
        
        var $ = cheerio.load(response.data);

        console.log("Page loaded");
        // Now, we grab every h2 within an article tag, and do the following:
        $("div.story-list-story").each(function(i, element) {
            // Save an empty result object
            var result = {};

            // Add the title and summary of every link, and save them as properties of the result object
            result.title = $(this).find("div.story-headline").find("h3").text();
            result.summary = $(this).find("p").text();
            result.link = $(this).find("div.story-headline").find("h3").children("a").attr("href");
            result.image = $(this).find(".story-image").find("img").attr("data-hi-res-src");

            if(result.title && result.link && result.summary) {
                // Using our Article model, create a new entry
                // This effectively passes the result object to the entry (and the title and link)
                var entry = new Article(result);



                // Now, save that entry to the db
                entry.save(function(err, doc) {
                    // Log any errors
                    if (err) {
                        console.log(err);
                    }
                    // Or log the doc
                    else {
                        console.log(doc);
                    }
                });
            } else {
                console.log("No title & link found. Skipping");
            }

        });

        res.redirect("/");
    });
});

// This will get the articles we scraped from the mongoDB
app.get("/articles", function(req, res) {
// Grab every doc in the Articles array
db.Article.find({}, function(error, doc) {
// Log any errors
if (error) {
  console.log(error);
}
// Or send the doc to the browser as a json object
else {
  res.json(doc);
}
});
});

// Route for grabbing a specific Article by id, populate it with it's note
app.get("/articles/:id", function(req, res) {
    // Using the id passed in the id parameter, prepare a query that finds the matching one in our db...
    db.Article.findOne({ _id: req.params.id })
      // ..and populate all of the notes associated with it
      .populate("note")
    // now, execute our query
    .exec(function(error, doc) {
        // Log any errors
        if (error) {
        console.log(error);
        }
        // Otherwise, send the doc to the browser as a json object
        else {
        res.json(doc);
        }
    });
    });

// Save an article
app.post("/articles/save/:id", function(req, res) {
    // Use the article id to find and update its saved boolean
    Article.findOneAndUpdate({ "_id": req.params.id }, { "saved": true})
    // Execute the above query
    .exec(function(err, doc) {
      // Log any errors
      if (err) {
        console.log(err);
      }
      else {
        // Or send the document to the browser
        res.send(doc);
      }
    });
});

// Delete an article
app.post("/articles/delete/:id", function(req, res) {
    // Use the article id to find and update its saved boolean
    Article.findOneAndUpdate({ "_id": req.params.id }, {"saved": false, "notes": []})
    // Execute the above query
    .exec(function(err, doc) {
      // Log any errors
      if (err) {
        console.log(err);
      }
      else {
        // Or send the document to the browser
        res.send(doc);
      }
    });
});


// Create a new note
app.post("/notes/save/:id", function(req, res) {
// Create a new note and pass the req.body to the entry
var newNote = new Note({
  body: req.body.text,
  article: req.params.id
});
console.log(req.body)
// And save the new note the db
newNote.save(function(error, note) {
  // Log any errors
  if (error) {
    console.log(error);
  }
  // Otherwise
  else {
    // Use the article id to find and update it's notes
    Article.findOneAndUpdate({ "_id": req.params.id }, {$push: { "notes": note } })
    // Execute the above query
    .exec(function(err) {
      // Log any errors
      if (err) {
        console.log(err);
        res.send(err);
      }
      else {
        // Or send the note to the browser
        res.send(note);
      }
    });
  }
});
});

// Delete a note
app.delete("/notes/delete/:note_id/:article_id", function(req, res) {
// Use the note id to find and delete it
Note.findOneAndRemove({ "_id": req.params.note_id }, function(err) {
  // Log any errors
  if (err) {
    console.log(err);
    res.send(err);
  }
  else {
    Article.findOneAndUpdate({ "_id": req.params.article_id }, {$pull: {"notes": req.params.note_id}})
     // Execute the above query
      .exec(function(err) {
        // Log any errors
        if (err) {
          console.log(err);
          res.send(err);
        }
        else {
          // Or send the note to the browser
          res.send("Note Deleted");
        }
      });
    }
});
});

// Start the server
app.listen(PORT, function() {
  console.log("App running on port " + PORT + "!");
});