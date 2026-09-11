const express = require('express')

const authRouter = require('./routes/auth.route')

const app = express()

app.use(express.json())
app.use(express.urlencoded({extended:true}))

app.get('/',(req, res)=>{
    res.send("Hello from server");
})

app.use('/api/auth',authRouter)

module.exports = app