# Customer Dress Shopping Website – Full Stack Project Documentation

## Technology Stack

### Frontend
- React.js
- React Router DOM
- Axios
- Bootstrap / Material UI
- Context API or Redux Toolkit

### Backend
- Node.js
- Express.js
- JWT Authentication
- Nodemailer
- bcrypt
- Multer (optional for image upload)

### Database
- MySQL

```txt
Database Username : root
Database Password : ebaPass
```

---

# Project Features

## Step 1 – Authentication Module

### Login Page
- Login using email and password
- Proper validation
- Redirect based on role

### Register Page
- New user signup
- Store details in MySQL
- Encrypt password using bcrypt

### Forgot Password
- Ask email ID
- Send password reset email using Nodemailer

---

## Step 2 – Product Detail Page

### Product Card View
- Traditional dress
- Kids dress
- Brand
- Size
- Color
- Price
- Dummy image

### Product Features
- Filter by:
  - Type
  - Brand
  - Size
  - Price
- Add to cart
- Buy now
- Quantity increase/decrease
- Stock status

### Cart Features
- Add product
- Remove product
- Update quantity
- Buy option
- Stock validation popup

---

## Step 3 – Delivery Location

### Address Features
- Select existing address
- Add new address
- Delivery details form

### Price Summary
- Product price
- Tax
- Delivery charge
- Total amount

---

## Step 4 – Payment Module

### Payment Methods
- UPI
- Credit Card
- Debit Card
- Cash On Delivery

### Payment Flow
- Save order details
- Reduce stock
- Clear cart

---

## Step 5 – Order Details

### Order List
- Order number
- Order date
- Total amount
- Paid status
- Delivery status
- Delivered date

### Order Tracking
- Address details
- Item details
- Tracking status

---

## Step 6 – Admin User Login

### Default Admin Credentials

```txt
User ID  : admin
Password : adm@123
```

### Admin Features
- Add products
- Edit products
- Delete products
- Update stock
- View orders
- Logout

---

## Step 7 – Normal User Features

### User Menu
- Product list
- Cart list
- Order details
- Logout

---

# MySQL Database Setup

## Create Database

```sql
CREATE DATABASE dress_shop;
USE dress_shop;
```

## Users Table

```sql
CREATE TABLE users (
    id INT PRIMARY KEY AUTO_INCREMENT,
    name VARCHAR(255),
    email VARCHAR(255) UNIQUE,
    password VARCHAR(255),
    role VARCHAR(50) DEFAULT 'USER',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

## Products Table

```sql
CREATE TABLE products (
    id INT PRIMARY KEY AUTO_INCREMENT,
    name VARCHAR(255),
    description TEXT,
    category VARCHAR(100),
    brand VARCHAR(100),
    size VARCHAR(50),
    color VARCHAR(50),
    price DECIMAL(10,2),
    stock INT,
    image VARCHAR(500),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

## Cart Table

```sql
CREATE TABLE cart (
    id INT PRIMARY KEY AUTO_INCREMENT,
    user_id INT,
    product_id INT,
    quantity INT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

## Orders Table

```sql
CREATE TABLE orders (
    id INT PRIMARY KEY AUTO_INCREMENT,
    order_number VARCHAR(100),
    user_id INT,
    address_id INT,
    total_amount DECIMAL(10,2),
    payment_method VARCHAR(100),
    paid_status VARCHAR(50),
    delivery_status VARCHAR(50),
    delivered_on DATETIME,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

---

# Backend Folder Structure

```txt
backend/
├── config/
├── controllers/
├── middleware/
├── models/
├── routes/
├── services/
├── utils/
├── app.js
└── server.js
```

# Frontend Folder Structure

```txt
frontend/
├── public/
├── src/
│   ├── components/
│   ├── pages/
│   ├── services/
│   ├── context/
│   ├── routes/
│   ├── App.js
│   └── index.js
```

---

# Backend Dependencies

```bash
npm install express mysql2 cors dotenv bcrypt jsonwebtoken nodemailer multer
```

# Frontend Dependencies

```bash
npm install react-router-dom axios bootstrap
```

---

# MySQL Connection Example

```js
const mysql = require('mysql2');

const connection = mysql.createConnection({
  host: 'localhost',
  user: 'root',
  password: 'Password1',
  database: 'dress_shop'
});

module.exports = connection;
```

---

# Final Features

## User Features
- Login
- Signup
- Forgot password
- Product browsing
- Filters
- Cart management
- Address management
- Payment options
- Order tracking

## Admin Features
- Product CRUD
- Stock management
- Order management
- Admin dashboard

---

# Technology Summary

- Frontend: React.js
- Backend: Node.js + Express.js
- Database: MySQL
- Authentication: JWT + bcrypt
- Email Service: Nodemailer
