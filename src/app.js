const express = require('express')
const cookieParser = require("cookie-parser");
const cors = require('cors')

const authRouter = require('./routes/auth.route')
const otpRouter = require('./routes/otp.route')

const app = express()

app.use(
    cors({
        origin:'http://localhost:5173',
        credentials:true,
    })
)
app.use(express.json())
app.use(express.urlencoded({extended:true}))
app.use(cookieParser()); 

app.get('/',(req, res)=>{
    res.send("Hello from server");
})

app.use('/api/auth',authRouter)
app.use('/api/otp',otpRouter)


module.exports = app