copyCopychevron-down

1.  [DEPLOYMENT GUIDE](/deployment-guide)

# ⚡Quick Setup

Deploy, configure, and start accepting payments on PayRam in under 10 minutes!

In this section, you’ll go through the complete setup of your PayRam server, including installation, security configuration, and encryption, to ensure it is fully prepared and running smoothly.

* * *

## 

[hashtag](#prerequisites)

**Prerequisites**

Before starting, please ensure your system meets the following requirements:

### 

[hashtag](#server-configuration)

**Server configuration**

-   Use a VPS or dedicated server with the minimum specifications required to host the PayRam server.
    

circle-info

**Recommended VPS Providers:**

-   **AWS**
    
-   **Google Cloud (GCP)**
    
-   **Azure**
    
-   **Hetzner**
    
-   **Hostinger**
    

### 

[hashtag](#minimum-server-requirements)

**Minimum server requirements**

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
    
    Do not publish it. From PayRam 3.11.0 the bundled PostgreSQL accepts connections only from inside the container, and updating applies that to existing installs. Releases up to 3.10.0 accept password logins (default payram/payram123) from any address that can reach the container, and installs made before 28 May 2026 publish 5432 on every interface. On those, run `docker port payram`; if 5432 is listed, block it (`payram_runbook` task `firewall_ports`) and update PayRam. Open the database with `docker exec -it payram psql -U payram payram`; back it up with `docker exec payram pg_dump -U payram payram > backup.sql`.
    

### 

[hashtag](#database-configuration)

Database configuration

-   To run PayRam smoothly, you must provision a PostgreSQL database with the following minimum configuration:
    
    **Minimum database requirements**:
    
    -   **Database engine**: PostgreSQL
        
    -   **vCPUs**: 2 CPU cores
        
    -   **Memory**: 8 GB
        
    -   **Storage**: 15 GB+ disk
        
    

circle-info

**Note** : These are the baseline requirements. Using a smaller configuration may cause performance issues during high transaction loads or while processing sweeps. You can scale up depending on the expected transaction volume.

* * *

## 

[hashtag](#payram-setup)

PayRam setup

1

### 

[hashtag](#connect-to-your-vps)

Connect to your VPS

-   Use SSH to connect to your server instance.
    

2

### 

[hashtag](#choose-your-network)

Choose your network

-   Decide whether to install on mainnet or testnet, based on your requirements.
    

circle-info

**Note** : Based on your requirements, choose the network on which you want to install PayRam. The Mainnet is used for production purposes, while the Testnet is used for development and testing PayRam features.

Mainnet

Testnet

3

### 

[hashtag](#run-the-command)

Run the command

-   Now, open your terminal and enter the command. Add sudo before the command if elevated privileges are required.
    

![](https://docs.payram.com/~gitbook/image?url=https%3A%2F%2Fcontent.gitbook.com%2Fcontent%2F2diixQuZV5bHAbOknKAq%2Fblobs%2FDxVeGclB2QVsFFGGshZt%2Fimage.png&width=768&dpr=3&quality=100&sign=34e46c52&sv=2)

4

### 

[hashtag](#installing-necessary-dependencies)

Installing necessary dependencies

-   When you run the command, the script handles the entire PayRam setup automatically. It checks for previous installations, validates required ports, detects the operating system, and ensures compatibility. Next, it installs or verifies Docker and PostgreSQL, creates the needed directories, and performs a disk space check. If any problems are found (such as low storage), the script will display a warning and ask you to confirm whether to proceed by typing Y or N.
    

![This is darwins masterpiece](https://docs.payram.com/~gitbook/image?url=https%3A%2F%2Fcontent.gitbook.com%2Fcontent%2F2diixQuZV5bHAbOknKAq%2Fblobs%2FXuJllRBGZzLq0d9N2bzh%2Fimage.png&width=768&dpr=3&quality=100&sign=5a6e3fd4&sv=2)

5

### 

[hashtag](#database-setup)

Database setup

-   Once the installation is complete, you will be prompted to choose between an External PostgreSQL Database or a Containerized PostgreSQL Database for setup.
    

![](https://docs.payram.com/~gitbook/image?url=https%3A%2F%2Fcontent.gitbook.com%2Fcontent%2F2diixQuZV5bHAbOknKAq%2Fblobs%2FhDOXziFLABlJbimUShyS%2Fimage.png&width=768&dpr=3&quality=100&sign=838d59e9&sv=2)

-   You can select any of the options based on your requirement
    
    -   Option 1
        
    -   Option 2
        
    

circle-info

**Note** : Option 1 is recommended for production environments.

Option 1

Option 2

-   If you select **Option 1**, you’ll be prompted to enter the following details:
    
    -   **Database Host**
        
    -   **Port**
        
    -   **Database Name**
        
    -   **Username**
        
    -   **Password**
        
    
    These details establish the connection between PayRam and your PostgreSQL database.
    
-   You can find them in your PostgreSQL server configuration or your hosting provider’s control panel. If you’re using a managed PostgreSQL service (for example, AWS RDS, Azure Database, or DigitalOcean), these values are available in the database connection settings.
    
-   **Example connection string**:
    
    -   In this example:
        
        -   `myuser` → Database username
            
        -   `mypassword` → Database password
            
        -   `db.example.com` → Database host
            
        -   `5432` → Database port
            
        -   `mydatabase` → Database name
            
        
    

circle-info

**Note** : This option is for testing only. For production environments, always use Option 1.

-   If you select **Option 2**, the script creates a local PostgreSQL database using Docker with the following default credentials:
    

6

### 

[hashtag](#ssl-configuration)

SSL configuration

-   After setting up the database, the script will prompt you to configure SSL by choosing from Let’s Encrypt (auto-generate free SSL), Custom Certificates (upload your own), or External SSL (cloud/proxy services).
    

![](https://docs.payram.com/~gitbook/image?url=https%3A%2F%2Fcontent.gitbook.com%2Fcontent%2F2diixQuZV5bHAbOknKAq%2Fblobs%2FV8iFlgyPD8twRnnUOs5R%2Fimage.png&width=768&dpr=3&quality=100&sign=94e8a016&sv=2)

-   You need to select one option from the three
    
    -   Option 1
        
    -   Option 2
        
    -   Option 3
        
    

Option 1

Option 2

Option 3

-   If you select Option 1, Let’s Encrypt will automatically generate and install a free SSL certificate for your domain within minutes, with certificates trusted by all browsers and auto-renewed every 90 days.
    

![](https://docs.payram.com/~gitbook/image?url=https%3A%2F%2Fcontent.gitbook.com%2Fcontent%2F2diixQuZV5bHAbOknKAq%2Fblobs%2FWTBE8sh9g89K3Z7CCMVK%2Fimage.png&width=768&dpr=3&quality=100&sign=4c6045f7&sv=2)

-   Select Option 2 if you already have your own SSL certificates. When prompted, provide the file path to the certificate files. The path you specify must contain two files: fullchain.pem and privkey.pem.
    

![](https://docs.payram.com/~gitbook/image?url=https%3A%2F%2Fcontent.gitbook.com%2Fcontent%2F2diixQuZV5bHAbOknKAq%2Fblobs%2FXQqRcsEhA9K6V4Emg671%2Fimage.png&width=768&dpr=3&quality=100&sign=be22d869&sv=2)

-   Select Option 3 if you’re generating SSL through a cloud service or if you want to skip SSL configuration.
    

![](https://docs.payram.com/~gitbook/image?url=https%3A%2F%2Fcontent.gitbook.com%2Fcontent%2F2diixQuZV5bHAbOknKAq%2Fblobs%2FIpdScWDPPimrrEVheC8E%2Fimage.png&width=768&dpr=3&quality=100&sign=d2cda870&sv=2)

7

### 

[hashtag](#aes-key-encryption)

AES key encryption

-   After selecting your SSL option, you will be prompted with the Hot Wallet Encryption Setup screen. At this step, press Enter to generate the AES-256 encryption key for your hot wallet.
    

![](https://docs.payram.com/~gitbook/image?url=https%3A%2F%2Fcontent.gitbook.com%2Fcontent%2F2diixQuZV5bHAbOknKAq%2Fblobs%2FHPO2ZmHDoFgVuVj1B3dZ%2Fimage.png&width=768&dpr=3&quality=100&sign=e58b3b03&sv=2)

8

### 

[hashtag](#review-the-settings)

Review the settings

-   The script then displays all the configurations you selected. Review the settings carefully to make sure they are correct before proceeding.
    

![](https://docs.payram.com/~gitbook/image?url=https%3A%2F%2Fcontent.gitbook.com%2Fcontent%2F2diixQuZV5bHAbOknKAq%2Fblobs%2F2heibY5vWBaNFFVealrB%2Fimage.png&width=768&dpr=3&quality=100&sign=c64725da&sv=2)

-   If the configuration is correct, press Enter and the script will set up the PayRam server based on the options you selected. This will start installing the payram server based on your configurations
    

![](https://docs.payram.com/~gitbook/image?url=https%3A%2F%2Fcontent.gitbook.com%2Fcontent%2F2diixQuZV5bHAbOknKAq%2Fblobs%2FHU2vsCdFwF65rdZLjrYJ%2Fimage.png&width=768&dpr=3&quality=100&sign=31eedee&sv=2)

9

### 

[hashtag](#installation-completed)

Installation completed

-   After the installation completes, a confirmation message appears in the terminal.
    

![](https://docs.payram.com/~gitbook/image?url=https%3A%2F%2Fcontent.gitbook.com%2Fcontent%2F2diixQuZV5bHAbOknKAq%2Fblobs%2FWY1bUDqtXkFSUxRv2OqJ%2Fimage.png&width=768&dpr=3&quality=100&sign=4ca6199e&sv=2)

Once the installation is complete, you’ll see “PayRam installation completed successfully” in the logs. You can then go to [http://arrow-up-right](http://yourserverip.com/)[yourserveriparrow-up-right](http://yourserverip.com/)[.comarrow-up-right](http://yourserverip.com/), replacing yourserverip with the IP address or domain where the PayRam server is hosted.

* * *

Now that you’ve successfully completed the setup, please go to the [onboarding configuration](/onboarding-guide/root-account-setup) to start setting up your root account for PayRam.

[PreviousIntroductionchevron-left](/deployment-guide/introduction)[NextAdvanced Setupchevron-right](/deployment-guide/advanced-setup)