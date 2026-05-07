-- Hostinger-safe schema import
-- 1) First create/select your database from Hostinger panel/phpMyAdmin.
-- 2) Then run this file (it does not attempt CREATE DATABASE or USE).

CREATE TABLE IF NOT EXISTS users (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  discord_id VARCHAR(32) NOT NULL UNIQUE,
  username VARCHAR(120) NOT NULL,
  avatar VARCHAR(255) NULL,
  role ENUM('admin', 'appraiser', 'clerk', 'user') NOT NULL DEFAULT 'user',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS businesses (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  name VARCHAR(255) NOT NULL,
  license_id VARCHAR(64) NOT NULL UNIQUE,
  type VARCHAR(120) NOT NULL,
  ceo_name VARCHAR(120) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS properties (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  parcel_id VARCHAR(32) NOT NULL UNIQUE,
  name VARCHAR(255) NOT NULL,
  type ENUM('Residential', 'Commercial', 'Government', 'Vacant Land') NOT NULL,
  address VARCHAR(255) NOT NULL,
  geojson JSON NOT NULL,
  owner_type ENUM('Individual', 'Business') NOT NULL,
  owner_name VARCHAR(255) NOT NULL,
  business_id BIGINT NULL,
  purchase_price DECIMAL(15,2) NOT NULL DEFAULT 0,
  purchase_date DATE NULL,
  assessed_value DECIMAL(15,2) NOT NULL DEFAULT 0,
  tax_rate DECIMAL(5,2) NOT NULL DEFAULT 0,
  annual_tax DECIMAL(15,2) NOT NULL DEFAULT 0,
  status ENUM('Owned', 'For Sale', 'Foreclosed', 'Government Seized') NOT NULL DEFAULT 'Owned',
  notes TEXT NULL,
  created_by BIGINT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT,
  FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS property_transactions (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  property_id BIGINT NOT NULL,
  from_owner VARCHAR(255) NOT NULL,
  to_owner VARCHAR(255) NOT NULL,
  sale_price DECIMAL(15,2) NOT NULL DEFAULT 0,
  transfer_date DATE NOT NULL,
  notes TEXT NULL,
  created_by BIGINT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (property_id) REFERENCES properties(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  user_id BIGINT NOT NULL,
  action VARCHAR(50) NOT NULL,
  table_name VARCHAR(50) NOT NULL,
  record_id BIGINT NOT NULL,
  old_data JSON NULL,
  new_data JSON NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS login_logs (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  user_id BIGINT NOT NULL,
  ip_address VARCHAR(64) NOT NULL,
  user_agent TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS map_configs (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  map_image_path VARCHAR(255) NOT NULL,
  bounds JSON NOT NULL,
  min_zoom INT NOT NULL DEFAULT -3,
  max_zoom INT NOT NULL DEFAULT 3,
  created_by BIGINT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT
);
