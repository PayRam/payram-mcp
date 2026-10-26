copyCopychevron-down

1.  [DEPLOYMENT GUIDE](/deployment-guide)

# ⚙️Advanced Setup

In this section, you’ll set up your PayRam server using Docker, covering installation, security configuration, and encryption to ensure your server is fully prepared and running smoothly.

* * *

## 

[hashtag](#docker-installation)

Docker installation

PayRam can be run using Docker, which provides a clean, isolated environment and avoids operating system or tooling incompatibilities. It also makes managing the database and environment variables simple and straightforward.

You can run PayRam inside a Docker container in any os with a simple command, either on testnet for development or on mainnet for production.

* * *

## 

[hashtag](#technical-knowledge-requirements-for-self-hosting)

Technical knowledge requirements for self-hosting

Running PayRam on your own servers requires understanding of technical concepts such as:

-   Installing and managing Docker containers
    
-   Allocating system resources effectively
    
-   Securing servers and sensitive data
    
-   Configuring environment variables and application settings correctly
    

Incorrect setup can result in data loss, security risks, or downtime.

circle-info

**Note** : If you do not have Docker installed or have limited technical knowledge, there is a Easy Method available that can install and configure your PayRam server in just less than 5 minutes.

**Checkout the Easy Method here :** [Quick Setup](/deployment-guide/quick-setup)

* * *

## 

[hashtag](#hardware-requirements)

Hardware requirements

### 

[hashtag](#server-configuration)

Server configuration

-   Use a VPS or dedicated server with the minimum specifications required to host the PayRam server.
    

### 

[hashtag](#minimum-server-requirements)

**Minimum server requirements:**

-   **CPU**: 4 cores
    
-   **RAM**: 4 GB
    
-   **Storage**: 15 GB+ disk
    
-   **Operating System**: Ubuntu 22.04
    

circle-info

**Note**: Depending on your expected usage and scale, additional resources may be required.

### 

[hashtag](#network-requirements)

**Network requirements**

-   Ensure the following ports are open on your server or VPS:
    
    Port
    
    Purpose
    
    80
    
    Used for running the Frontend (FE) on standard HTTP protocol.
    
    8080
    
    Legacy installs only - older versions served the backend on 8080. Current installers publish both the frontend and the API on port 80 (and 443 with SSL).
    
    443
    
    Required for the Frontend when serving the application over HTTPS (secure connection).
    
    8443
    
    Required for the Backend when serving APIs over HTTPS (secure connection).
    
    5432
    
    Do not publish it. From PayRam 3.11.0 the bundled PostgreSQL accepts connections only from inside the container, and updating applies that to existing installs. Releases up to 3.10.0 accept password logins with the shared default password from any address that can reach the container, and installs made before 28 May 2026 publish 5432 on every interface. On those, run `docker port payram`; if 5432 is listed, block it (`payram_runbook` task `firewall_ports`) and update PayRam. Open the database with `docker exec -it payram psql -U payram payram`; back it up with `docker exec payram pg_dump -U payram payram > backup.sql`.
    

* * *

## 

[hashtag](#quick-start)

Quick start

-   Use this guide to run PayRam with Docker on testnet for local setup and testing. See below for instructions on deploying PayRam in production on the mainnet.
    
-   Assuming you have Docker installed and running, pull the latest PayRam image and start a container
    

circle-info

**Note**: When running the Docker command, do not modify the port mappings. Changing the default ports may cause PayRam to stop working correctly or prevent it from connecting to required services.

This command does the following:

-   **Runs PayRam in the background** (-d) with the name payram-testnet.
    
-   **Exposes ports**:
    
    -   8080 → legacy internal API access (current installs serve the API on port 80)
        
    -   80 → HTTP access
        
    
-   **Sets environment variables**:
    
    -   AES\_KEY: Encryption key used for securing data.
        
    -   SSL\_CERT\_PATH: Path to SSL certificates (optional in testnet).
        
    -   BLOCKCHAIN\_NETWORK\_TYPE: Configures the blockchain network (testnet).
        
    -   SERVER: Marks the environment as DEVELOPMENT.
        
    -   POSTGRES\_\*: Database connection details.
        
    
-   **Mounts volumes**:
    
    -   home/payram:/root/payram → Application data.
        
    -   home/payram/log/supervisord:/var/log → Log files.
        
    -   home/payram/db/postgres:/var/lib/payram/db/postgres → Database storage.
        
    -   Pulls and runs the PayRam Docker image: payramapp/payram:1.6.0.
        
    

circle-info

**Note**: After the installation is complete, you can access PayRam at https://your-domain.com/login.

For detailed configuration steps, refer to the [Merchant Guide](/onboarding-guide/introduction) for further instructions.

* * *

## 

[hashtag](#advance-setup)

Advance setup

-   If you’re running PayRam in production, keep the following in mind: you need to configure an external database, set up proper SSL certificates, and generate your own unique AES key for security.
    

### 

[hashtag](#aes-key-generation)

AES key generation

-   A secure encryption key required by PayRam.
    
-   In production, you should generate your own **AES key** using:
    
-   Example in Docker:
    

### 

[hashtag](#postgres-setup)

Postgres setup

To run **PayRam** safely and reliably in a production environment, you must connect it to an **external PostgreSQL database** hosted by a trusted and managed provider. Local or containerized databases should not be used in production, as they are not secure, scalable, or fault-tolerant.

-   Recommended PostgreSQL providers include:
    
    -   **Amazon RDS for PostgreSQL / Aurora PostgreSQL**
        
    -   **Google Cloud SQL for PostgreSQL**
        
    -   **Azure Database for PostgreSQL**
        
    -   **DigitalOcean Managed PostgreSQL**
        
    

#### 

[hashtag](#required-environment-variables)

**Required environment variables**

-   When your provider gives you a connection URL, simply take each part of it and map it to PayRam’s required environment variables.
    
-   The following example shows how this connection URL can be expressed as environment variables for PayRam:
    

### 

[hashtag](#ssl-configuration)

SSL configuration

-   PayRam requires **SSL/TLS certificates** to enable secure **HTTPS** connections in production.
    
-   If you are using a third-party provider such as **Cloudflare** or **AWS Load Balancer** that manages HTTPS for you, you can leave this value empty:
    
-   If you are managing certificates yourself on the PayRam server, you must point this variable to the directory where your domain’s SSL/TLS certificates are stored.
    
-   The most common setup is with **Let’s Encrypt**, which stores certificates in:
    
-   Ensure the directory contains the correct certificate files for your domain (commonly fullchain.pem and privkey.pem).
    

circle-info

**Note**: Setting the SSL\_CERT\_PATH is required only if you manage HTTPS directly on your PayRam server.If you’re using a third-party service such as Cloudflare that already handles HTTPS, you can leave this value "**SSL\_CERT\_PATH**" empty.

### 

[hashtag](#production-setup)

Production setup

Before starting PayRam for the first time, make sure you **note down and store all necessary configurations securely**. These will be required for future updates or troubleshooting:

-   **AES\_KEY** → Keep a copy of the key securely; required for decrypting data in future updates.
    
-   **Postgres details** → Database name, username, password, and port. You will need the same details to reconnect or update.
    
-   **Volume paths (WORKDIR)** → Note the host paths you plan to use for data, logs, and database files (e.g., `/home/payram`). These must remain consistent for updates
    

#### 

[hashtag](#what-does-this-command-do)

**What does this command do?**

-   **Runs PayRam on mainnet** in a Docker container.
    
-   **Maps and exposes ports**:
    
    -   8080 → legacy internal API access (current installs serve the API on port 80)
        
    -   8443 → secure HTTPS API
        
    -   80 → standard HTTP
        
    -   443 → HTTPS (requires valid SSL certs)
        
    

⚠️ **Important on HTTPS:**

-   If you **set SSL\_CERT\_PATH and mount certs**, HTTPS (443, 8443) will work and PayRam will serve securely.
    
-   If you **leave SSL\_CERT\_PATH=""**, PayRam will only serve over HTTP. This is acceptable if you use an external TLS termination service (like Cloudflare, reverse proxy, or load balancer).
    
-   **Configures environment variables**:
    
    -   AES\_KEY must be a secure random hex string in production.
        
    -   SERVER=PRODUCTION ensures PayRam runs in production mode.
        
    -   Postgres settings must point to your **production-grade database**.
        
    
-   **Mounts volumes**:
    
    -   $WORKDIR:/root/payram → application data.
        
    -   $WORKDIR/log/supervisord:/var/log → logs.
        
    -   $WORKDIR/db/postgres:/var/lib/payram/db/postgres → Postgres storage (only if self-hosted).
        
    -   /etc/letsencrypt:/etc/letsencrypt → host SSL certs (required if SSL\_CERT\_PATH is set).
        
    

* * *

## 

[hashtag](#updating-payram-docker-container)

Updating PayRam Docker container

1

### 

[hashtag](#prepare-before-updating)

Prepare before updating

Before stopping or removing any containers, make sure you **note down all current configurations**:

-   **AES\_KEY** → Must be the same as the current container, otherwise PayRam will fail to decrypt data.
    
-   **Postgres details** → Database name, username, password, and port must remain the same.
    
-   **Volume mappings** → Use the exact same host paths to persist data (e.g., /home/ubuntu/payram, /home/ubuntu/payram/log/supervisord, /home/ubuntu/payram/db/postgres).
    
-   **SSL\_CERT\_PATH** → Keep the same configuration (empty for testnet, or set if using SSL).
    
-   **Network type and SERVER environment** → Must be the same as the current container (testnet & DEVELOPMENT, mainnet & PRODUCTION) or it will cause issues.
    

circle-info

**If any of these are changed, you may lose access to stored data or encounter startup errors.**

2

### 

[hashtag](#check-running-containers)

Check running containers

This shows the currently running PayRam container. Note the **CONTAINER ID** or **NAME**.

3

### 

[hashtag](#stop-the-running-container)

Stop the running container

4

### 

[hashtag](#remove-the-stopped-container)

Remove the stopped container

5

### 

[hashtag](#check-existing-images)

Check existing images

6

### 

[hashtag](#remove-the-old-image)

Remove the old image

7

### 

[hashtag](#run-the-updated-container)

Run the updated container

Start PayRam again with the new version using your saved configuration values. Make sure to use the same AES key, database, server, and other details as before to avoid errors.

8

### 

[hashtag](#verify-the-update)

Verify the update

You should now see the container running with the new version.

* * *

Done! All your data and configurations are preserved while updating PayRam.

[PreviousQuick Setupchevron-left](/deployment-guide/quick-setup)[NextIntroductionchevron-right](/onboarding-guide/introduction)