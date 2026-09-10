const dotenv = require('dotenv')
const express = require('express')

dotenv.config()
const app = require('./src/app')

app.listen(process.env.PORT, ()=>{
    console.log('Hello from server')
})