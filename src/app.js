const express = require('express')
const cookieParser = require("cookie-parser");
const cors = require('cors')
const http = require("http");

const authRouter = require('./routes/auth.route')
const otpRouter = require('./routes/otp.route')
const userRouter = require("./routes/user.route");
const meetingRouter = require('./routes/meeting.route')
// socket
const { initSocket } = require("./socket/socket");

const server = express()
const app = http.createServer(server); // wrapping Express in HTTP server

// middleware
server.use(
    cors({
        origin:process.env.FRONTEND_URI,
        credentials:true,
    })
)
server.use(express.json())
server.use(express.urlencoded({extended:true}))
server.use(cookieParser()); 

// demo route
server.get('/',(req, res)=>{
    res.send("Hello from server");
})

// routes
server.use('/api/auth',authRouter)
server.use('/api/otp',otpRouter)
server.use("/api/user", userRouter);
server.use("/api/meetings", meetingRouter);

// socket.io
initSocket(app)

// const startServer = async () => {
// 	try {
// 		await connectDB();
// 		const PORT = process.env.PORT || 5000;
// 		server.listen(PORT, () => {
// 			console.log(`🚀 Server running on port ${PORT} in ${process.env.NODE_ENV} mode`);
// 			console.log(`🔌 Socket.io ready`);
// 		});
// 	} catch (err) {
// 		console.error("Failed to start server:", err);
// 		process.exit(1);
// 	}
// };

// startServer();

module.exports = app