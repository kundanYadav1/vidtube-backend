import dotenv from "dotenv";
import { app } from "./app.js";
import {  connectDB} from "./db/index.js";


dotenv.config({
    path:"./.env"
})
 connectDB()
.then(()=>{
    const PORT= process.env.PORT || 8001 
app.listen(PORT, ()=> {
    console.log(`Server is running on port ${PORT}`)
})
})
.catch((err)=>{
    console.log("MongoDB connection error")
})
