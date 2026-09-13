const mongoose = require("mongoose");

const dataSchema = new mongoose.Schema(
	{
		userId: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "user",
		},

		
	},
	{ timestamps: true },
);

const userDataModel = mongoose.model("userData", dataSchema);

module.exports = userDataModel;
